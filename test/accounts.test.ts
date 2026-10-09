import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DB } from './helpers/db';

vi.mock('../worker/ai', () => ({
  makePersonality: vi.fn(async () => ({personality:{name:'Account Buck',tagline:'Test only',voice:'dry',quirks:[]},birthEntry:'Born',meta:{model:'test',prompt:'test'}})),
  writeDiary: vi.fn(async () => ({entry:'Diary',motif:'city',meta:{model:'test',prompt:'test'}})),
  paintStamp: vi.fn(async () => new Uint8Array([1])),
  writeEulogy: vi.fn(async () => ({eulogy:'Ended',closing:null,meta:{model:'test',prompt:'test'}})),
}));
vi.mock('../worker/email', () => ({sendMail:vi.fn(async () => true),queueMail:vi.fn(async () => 'queued'),retryMail:vi.fn(async () => {})}));
vi.mock('../worker/util', async (actual) => ({...(await actual()),sleep: () => new Promise(() => {})}));

import worker from '../worker/index';
import * as engine from '../worker/engine';
import { backfillParticipants } from '../worker/accounts';
import { openBooks } from '../worker/books';
import { getBill, getPass } from '../worker/db';
import { queueMail, sendMail } from '../worker/email';
import { capToken, participantId, recoveryHash } from '../worker/util';

const ctx={waitUntil(p:Promise<unknown>){p.catch(()=>{});}};
const place={city:'Austin',region:'TX',country:'US',lat:30.3,lng:-97.7};
let db:DB,env:any;
beforeEach(()=>{
  vi.clearAllMocks();
  db=new DB();
  env={DB:db,TOKEN_SECRET:'accounts-test',PAYPAL_MODE:'mock',APP_URL:'http://localhost',STAMPS:{put:async()=>{}},EMAIL_MODE:'log',
    RL_WRITE:{limit:async()=>({success:true})},RL_AI:{limit:async()=>({success:true})}};
});

const call=(path:string,init:{method?:string;body?:unknown;cookie?:string;origin?:string}={})=>worker.fetch(new Request(`http://localhost${path}`,{
  method:init.method??(init.body===undefined?'GET':'POST'),
  headers:{'Content-Type':'application/json',...(init.cookie?{Cookie:init.cookie}:{}),...(init.origin?{Origin:init.origin}:{})},
  body:init.body===undefined?undefined:JSON.stringify(init.body)}),env,ctx);

/** The code from the most recent sign-in email. */
const lastCode=()=>{
  const mail=vi.mocked(sendMail).mock.calls.filter(([,m])=>m.kind==='signin').at(-1)![1];
  return {code:mail.code!.replace(' ',''),link:new URL(mail.button!.url),to:mail.to};
};

async function signIn(email:string){
  const start=await (await call('/api/auth/start',{body:{email}})).json() as {challenge:string};
  const res=await call('/api/auth/verify',{body:{challenge:start.challenge,code:lastCode().code}});
  expect(res.status).toBe(200);
  return res.headers.get('Set-Cookie')!.split(';')[0];
}

/** A bill held by `holder` after a delivered pass, like one passed along by email. */
function heldBill(holder='stranger@example.com',serial='FWP-0001',id='b'){
  db.sqlite.prepare("INSERT INTO bills(id,seq,serial,status,creator_email,holder_pass_id,holder_since,created_at) VALUES(?,?,?,'holding','creator@example.com',?,?,?)")
    .run(id,Number(serial.slice(-4)),serial,`${id}-holder`,Date.now(),Date.now());
  db.sqlite.prepare("INSERT INTO passes(id,bill_id,kind,recipient_email,status,paypal_mode,created_at,settled_at,holder_notified) VALUES(?,?,'pass',?,'delivered','mock',?,?,1)")
    .run(`${id}-holder`,id,holder,Date.now(),Date.now());
  return getBill(env,id);
}

describe('sign-in by emailed code or link',()=>{
  it('signs in with the code once, then rejects reuse',async()=>{
    const start=await (await call('/api/auth/start',{body:{email:'Reader@Example.com'}})).json() as {challenge:string;sentTo:string};
    expect(start.sentTo).toBe('r•••@e•••.com');
    expect(lastCode().to).toBe('reader@example.com');
    expect((await call('/api/auth/verify',{body:{challenge:start.challenge,code:'000000'===lastCode().code?'111111':'000000'}})).status).toBe(400);
    const ok=await call('/api/auth/verify',{body:{challenge:start.challenge,code:lastCode().code}});
    expect(ok.status).toBe(200);
    const cookie=ok.headers.get('Set-Cookie')!;
    expect(cookie).toContain('HttpOnly');expect(cookie).toContain('SameSite=Lax');
    const me=await (await call('/api/me',{cookie:cookie.split(';')[0]})).json() as {me:{email:string}};
    expect(me.me.email).toBe('reader@example.com');
    expect((await call('/api/auth/verify',{body:{challenge:start.challenge,code:lastCode().code}})).status).toBe(400);
  });
  it('signs in with the emailed link, and stops after five wrong codes',async()=>{
    const first=await (await call('/api/auth/start',{body:{email:'link@example.com'}})).json() as {challenge:string};
    const {link}=lastCode();
    expect(link.pathname).toBe('/signin');
    expect((await call('/api/auth/verify',{body:{challenge:link.searchParams.get('ch'),link:link.searchParams.get('k')}})).status).toBe(200);
    db.sqlite.exec("UPDATE auth_challenges SET created_at = created_at - 60000");
    const second=await (await call('/api/auth/start',{body:{email:'link@example.com'}})).json() as {challenge:string};
    expect(second.challenge).not.toBe(first.challenge);
    const right=lastCode().code, wrong=right==='123456'?'654321':'123456';
    for(let i=0;i<5;i++) await call('/api/auth/verify',{body:{challenge:second.challenge,code:wrong}});
    const locked=await call('/api/auth/verify',{body:{challenge:second.challenge,code:right}});
    expect(locked.status).toBe(400);
    expect(((await locked.json()) as {error:string}).error).toContain('Too many');
  });
  it('ignores a session cookie on a cross-site write',async()=>{
    const cookie=await signIn('csrf@example.com');
    heldBill('holder@example.com');
    const res=await call('/api/bills/FWP-0001/follow',{body:{preference:'on_end'},cookie,origin:'https://evil.example'});
    expect(res.status).toBe(403);
    expect((await call('/api/bills/FWP-0001/follow',{body:{preference:'on_end'},cookie,origin:'http://localhost'})).status).toBe(200);
  });
});

describe('a stranger who signs up later',()=>{
  it('sees hops written before the account existed, including rows from before participant ids',async()=>{
    const bill=(await heldBill())!;
    await engine.contribute(env,ctx,place,bill,{words:'red blue green orange',next:null});
    // A legacy row from before accounts: an email but no participant id.
    db.sqlite.exec("INSERT INTO bills(id,seq,serial,status,creator_email,created_at) VALUES('old',9,'FWP-0009','wild','stranger@example.com',1)");
    db.sqlite.exec("INSERT INTO hops(id,bill_id,idx,status,words,content_words,writer_email,city,country,created_at,confirmed_at) VALUES('opening:old','old',1,'confirmed','amber robots chase comets',4,'stranger@example.com','Paris','FR',1,1)");
    const cookie=await signIn('stranger@example.com');
    const dash=await (await call('/api/me/dashboard',{cookie})).json() as any;
    expect(dash.hops.map((h:any)=>h.words).sort()).toEqual(['amber robots chase comets','red blue green orange']);
    expect(dash.hops.find((h:any)=>h.serial==='FWP-0009').opening).toBe(true);
    expect(dash.started.map((b:any)=>b.serial)).toEqual(['FWP-0009']);
    expect(dash.stats).toMatchObject({hops:2,words:8,held:1,started:1,places:2});
    // Nothing about who wrote it changes publicly.
    const pub=await (await call('/api/bills/FWP-0001')).json() as any;
    expect(pub.hops[0]).toMatchObject({penName:null,penVerified:false});
  });
  it('backfills participant ids in the background, then reads nothing',async()=>{
    db.sqlite.exec("INSERT INTO bills(id,seq,serial,status,creator_email,created_at) VALUES('old',9,'FWP-0009','wild','legacy@example.com',1)");
    db.sqlite.exec("INSERT INTO follows(id,bill_id,email,preference,created_at) VALUES('f1','old','legacy@example.com','on_end',1)");
    await backfillParticipants(env);
    const pid=await participantId(env,'legacy@example.com');
    expect(db.sqlite.prepare("SELECT creator_pid FROM bills WHERE id='old'").get()?.creator_pid).toBe(pid);
    expect(db.sqlite.prepare("SELECT pid FROM follows WHERE id='f1'").get()?.pid).toBe(pid);
    // Seeded hops have no writer, so they never enter the to-do index the backfill reads.
    db.sqlite.exec("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<50) INSERT INTO hops(id,bill_id,idx,status,words,content_words,created_at) SELECT 's'||i,'old',i+1,'confirmed','red blue green orange',4,1 FROM n");
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM hops INDEXED BY hops_pid_todo WHERE writer_pid IS NULL AND writer_email IS NOT NULL").get()?.n).toBe(0);
    await backfillParticipants(env);
  });
  it('hands a signed-in holder their keys, so a lost email never strands a buck',async()=>{
    await heldBill('keeper@example.com');
    const cookie=await signIn('keeper@example.com');
    const keys=await (await call('/api/me/keys/FWP-0001',{cookie})).json() as {t:string;c:string|null};
    expect(keys.t).toBe(await capToken(env,'holder','b-holder'));
    expect(keys.c).toBeNull();
    const other=await signIn('someone@example.com');
    expect(await (await call('/api/me/keys/FWP-0001',{cookie:other})).json()).toEqual({t:null,c:null});
    const dash=await (await call('/api/me/dashboard',{cookie})).json() as any;
    expect(dash.inHand).toMatchObject([{serial:'FWP-0001',action:'write'}]);
  });
});

describe('playing without an account',()=>{
  it('follows and claims with just an email, and never creates an account',async()=>{
    db.sqlite.exec("INSERT INTO bills(id,seq,serial,status,creator_email,created_at,wild_since) VALUES('w',3,'FWP-0003','wild','creator@example.com',1,1)");
    const followed=await call('/api/bills/FWP-0003/follow',{body:{email:'Reader@Example.com',preference:'on_end'}});
    expect(await followed.json()).toEqual({ok:true,verified:false,account:false});
    expect(vi.mocked(queueMail).mock.calls.some(([,m])=>m.kind==='follow_confirm'&&m.to==='reader@example.com')).toBe(true);
    expect(db.sqlite.prepare("SELECT verified FROM follows WHERE email='reader@example.com'").get()?.verified).toBe(0);
    const claimed=await call('/api/bills/FWP-0003/claim',{body:{email:'claimer@example.com'}});
    expect(claimed.status).toBe(200);
    expect(((await claimed.json()) as {token:string}).token).toBeTruthy();
    expect(db.sqlite.prepare("SELECT recipient_email FROM passes WHERE bill_id='w'").get()?.recipient_email).toBe('claimer@example.com');
    // Signed out with no email, both ask for one instead of failing over to an account.
    expect((await call('/api/bills/FWP-0003/follow',{body:{preference:'on_end'}})).status).toBe(403);
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM users").get()?.n).toBe(0);
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM sessions").get()?.n).toBe(0);
  });
});

describe('an account offer wherever an email is typed',()=>{
  const wild=()=>db.sqlite.exec("INSERT INTO bills(id,seq,serial,status,creator_email,created_at,wild_since) VALUES('w',3,'FWP-0003','wild','creator@example.com',1,1)");
  const verifyLink=(url:string)=>{const u=new URL(url);return call('/api/auth/verify',{body:{challenge:u.searchParams.get('ch'),link:u.searchParams.get('k')}});};

  it('follow: one confirmation email, and one tap confirms the follow and creates the account',async()=>{
    wild();
    const res=await call('/api/bills/FWP-0003/follow',{body:{email:'reader@example.com',preference:'every_hop',penName:'Night Owl'}});
    expect(await res.json()).toEqual({ok:true,verified:false,account:true});
    // Nothing exists until the address is proven.
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM users").get()?.n).toBe(0);
    const mail=vi.mocked(queueMail).mock.calls.map(([,m])=>m).find(m=>m.kind==='follow_confirm')!;
    expect(mail.button!.label).toBe('Confirm and create my account');
    expect(mail.secondary!.url).toContain('/f/');
    expect(vi.mocked(sendMail).mock.calls.filter(([,m])=>m.kind==='signin')).toHaveLength(0);
    // The emailed link works only as a link: the offer has no code to guess.
    const ch=new URL(mail.button!.url).searchParams.get('ch');
    expect((await call('/api/auth/verify',{body:{challenge:ch,code:'123456'}})).status).toBe(400);
    const done=await verifyLink(mail.button!.url);
    expect(done.status).toBe(200);
    expect(((await done.json()) as any).me).toMatchObject({email:'reader@example.com',handle:'Night Owl'});
    expect(db.sqlite.prepare("SELECT verified,preference FROM follows WHERE email='reader@example.com'").get()).toMatchObject({verified:1,preference:'every_hop'});
    expect((await getBill(env,'w'))!.follower_count).toBe(1);
  });
  it('follow: a pen name someone else owns is refused before anything is sent',async()=>{
    wild();
    await call('/api/me/handle',{body:{handle:'Night Owl'},cookie:await signIn('owner@example.com')});
    vi.mocked(queueMail).mockClear();
    const res=await call('/api/bills/FWP-0003/follow',{body:{email:'reader@example.com',preference:'on_end',penName:'night owl'}});
    expect(res.status).toBe(409);
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM follows WHERE email='reader@example.com'").get()?.n).toBe(0);
    expect(queueMail).not.toHaveBeenCalled();
  });
  it('follow: when the confirmation was already sent, the offer goes on its own',async()=>{
    wild();
    await call('/api/bills/FWP-0003/follow',{body:{email:'reader@example.com',preference:'on_end'}});
    const res=await call('/api/bills/FWP-0003/follow',{body:{email:'reader@example.com',preference:'on_end',penName:'Night Owl'}});
    expect(await res.json()).toEqual({ok:true,verified:false,account:true});
    const {code,to}=lastCode();
    expect(to).toBe('reader@example.com');
    expect(code).toHaveLength(6);
  });
  it('claim: the claimer gets a code to finish the account on the page',async()=>{
    wild();
    const res=await call('/api/bills/FWP-0003/claim',{body:{email:'claimer@example.com',penName:'Lark'}});
    const out=await res.json() as {token:string;account:{challenge:string;sentTo:string;penName:string}};
    expect(out.token).toBeTruthy();
    expect(out.account).toMatchObject({sentTo:'c•••@e•••.com',penName:'Lark'});
    const mail=vi.mocked(sendMail).mock.calls.map(([,m])=>m).filter(m=>m.kind==='signin').at(-1)!;
    expect(mail.heading).toBe('Make it yours, Lark.');
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM users").get()?.n).toBe(0);
    const done=await call('/api/auth/verify',{body:{challenge:out.account.challenge,code:lastCode().code}});
    expect(((await done.json()) as any).me).toMatchObject({email:'claimer@example.com',handle:'Lark'});
  });
  it('release: the creator-key email carries the offer, and a replayed release keeps its link',async()=>{
    const input={orderId:'MOCKORDER-offer',recoveryKey:'o'.repeat(32),creatorEmail:'maker@example.com',words:'amber robots chase comets',firstRecipient:null,penName:'Tin Poet',createAccount:true};
    await env.DB.prepare("INSERT INTO checkout_orders(order_id,recovery_hash,paypal_mode,purpose,created_at) VALUES (?,?,'mock','mint',?)").bind(input.orderId,await recoveryHash(input.recoveryKey),Date.now()).run();
    await engine.mintBill(env,ctx,place,input);
    await engine.mintBill(env,ctx,place,input);
    const creatorMails=vi.mocked(queueMail).mock.calls.map(([,m])=>m).filter(m=>m.kind==='creator');
    expect(new Set(creatorMails.map(m=>m.secondary!.url)).size).toBe(1);
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM auth_challenges").get()?.n).toBe(1);
    const done=await verifyLink(creatorMails[0].secondary!.url);
    expect(((await done.json()) as any).me).toMatchObject({email:'maker@example.com',handle:'Tin Poet'});
    // The foreword was signed before the account existed; claiming the name marks it.
    expect(db.sqlite.prepare("SELECT pen_name,pen_verified FROM hops WHERE id LIKE 'opening:%'").get()).toMatchObject({pen_name:'Tin Poet',pen_verified:1});
  });
  it('caps wrong codes per address per day, while the emailed link still works',async()=>{
    const challenges:string[]=[];
    for(let i=0;i<3;i++){
      challenges.push(((await (await call('/api/auth/start',{body:{email:'target@example.com'}})).json()) as {challenge:string}).challenge);
      db.sqlite.exec("UPDATE auth_challenges SET created_at = created_at - 60000");
    }
    const right=lastCode();
    let wrong=0;
    for(const ch of challenges) for(let i=0;i<4&&wrong<10;i++,wrong++) await call('/api/auth/verify',{body:{challenge:ch,code:right.code==='000000'?'111111':'000000'}});
    const blocked=await call('/api/auth/verify',{body:{challenge:challenges[2],code:right.code}});
    expect(blocked.status).toBe(429);
    expect((await call('/api/auth/verify',{body:{challenge:right.link.searchParams.get('ch'),link:right.link.searchParams.get('k')}})).status).toBe(200);
  });
});

describe('holder tickets',()=>{
  it('follows and starts sign-in as the address it was passed to, even after it moves on',async()=>{
    await heldBill('passed@example.com');
    const t=await capToken(env,'holder','b-holder');
    const view=await (await call(`/api/bills/FWP-0001/holder?t=${t}`)).json() as any;
    expect(view.ticket.email).toBe('p•••@e•••.com');
    expect(view.account).toBeNull();
    db.sqlite.exec("UPDATE bills SET status='wild',holder_pass_id=NULL WHERE id='b'");
    const followed=await (await call('/api/bills/FWP-0001/follow',{body:{ticket:view.ticket.token,preference:'every_hop'}})).json();
    expect(followed).toEqual({ok:true,verified:true});
    expect(db.sqlite.prepare("SELECT verified,preference FROM follows WHERE email='passed@example.com'").get()).toMatchObject({verified:1,preference:'every_hop'});
    expect((await getBill(env,'b'))!.follower_count).toBe(1);
    const start=await (await call('/api/auth/start',{body:{serial:'FWP-0001',ticket:view.ticket.token}})).json() as {sentTo:string};
    expect(start.sentTo).toBe('p•••@e•••.com');
    expect(lastCode().to).toBe('passed@example.com');
    const forged=await call('/api/bills/FWP-0001/follow',{body:{ticket:'b-holder.forged',preference:'every_hop'}});
    expect(forged.status).toBe(403);
  });
  it('recognizes the signed-in account as the holder',async()=>{
    await heldBill('mine@example.com');
    const cookie=await signIn('mine@example.com');
    await call('/api/me/handle',{body:{handle:'Mina'},cookie});
    const view=await (await call(`/api/bills/FWP-0001/holder?t=${await capToken(env,'holder','b-holder')}`,{cookie})).json() as any;
    expect(view.account).toEqual({handle:'Mina'});
  });
});

describe('claimed pen names',()=>{
  it('signs only for their owner, verified, in the claimed spelling',async()=>{
    const cookie=await signIn('owner@example.com');
    expect((await call('/api/me/handle',{body:{handle:'Jo March'},cookie})).status).toBe(200);
    expect((await call('/api/me/handle',{body:{handle:'jo march'},cookie:await signIn('copycat@example.com')})).status).toBe(409);
    expect((await call('/api/me/handle',{body:{handle:'admin'},cookie})).status).toBe(400);
    const other=(await heldBill('copycat@example.com'))!;
    await expect(engine.contribute(env,ctx,place,other,{words:'red blue green orange',next:null,penName:'JO MARCH'})).rejects.toThrow('claimed');
    const mine=(await heldBill('owner@example.com','FWP-0002','b2'))!;
    await engine.contribute(env,ctx,place,mine,{words:'red blue green orange',next:null,penName:'jo march'});
    const pub=await (await call('/api/bills/FWP-0002')).json() as any;
    expect(pub.hops[0]).toMatchObject({penName:'Jo March',penVerified:true});
    expect(await (await call('/api/pen-names/JO%20MARCH',{cookie})).json()).toEqual({claimed:true,yours:true});
  });
});

describe('admin releases without checkout',()=>{
  const draft={words:'amber robots chase comets',firstRecipient:'first@example.com',free:true};
  it('refuses anyone who is not a signed-in admin',async()=>{
    expect((await call('/api/bills',{body:{...draft,creatorEmail:'x@example.com'}})).status).toBe(403);
    expect((await call('/api/bills',{body:draft,cookie:await signIn('plain@example.com')})).status).toBe(403);
    expect((await call('/api/bills',{body:{words:draft.words,creatorEmail:'x@example.com'}})).status).toBe(402);
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM bills").get()?.n).toBe(0);
  });
  it('mints for a signed-in admin with no checkout, and Open Books shows it as $0 in',async()=>{
    const cookie=await signIn('ammon@example.com');
    const marked=await worker.fetch(new Request('http://localhost/api/admin/users',{method:'POST',headers:{Authorization:'Bearer dev-admin'},body:JSON.stringify({email:'ammon@example.com',admin:true})}),{...env,ADMIN_TOKEN:'dev-admin'},ctx);
    expect(marked.status).toBe(200);
    const res=await call('/api/bills',{body:draft,cookie});
    expect(res.status).toBe(200);
    const {serial}=await res.json() as {serial:string};
    const bill=db.sqlite.prepare("SELECT * FROM bills WHERE serial=?").get(serial)!;
    expect(bill).toMatchObject({creator_email:'ammon@example.com',checkout_order_id:null,status:'in_transit'});
    expect(bill.comped_by).toBeTruthy();
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM checkout_orders").get()?.n).toBe(0);
    const pass=db.sqlite.prepare("SELECT * FROM passes WHERE bill_id=?").get(bill.id)!;
    expect(pass).toMatchObject({kind:'mint',recipient_email:'first@example.com',recipient_pid:await participantId(env,'first@example.com')});
    const books=await openBooks(env);
    expect(books.totals.checkouts).toBe(0);
    expect(books.rows.filter(r=>r.serial===serial).map(r=>[r.direction,r.kind,r.amount])).toEqual(expect.arrayContaining([['in','comp',0],['out','first_holder',1]]));
    // A signed-in creator is followed and recognized without typing their email.
    const dash=await (await call('/api/me/dashboard',{cookie})).json() as any;
    expect(dash.started[0].serial).toBe(serial);
    expect(dash.following[0]).toMatchObject({serial,preference:'every_hop'});
    expect((await getPass(env,pass.id))!.paypal_mode).toBe('mock');
  });
});
