import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB } from './helpers/db';

vi.mock('../worker/ai', () => ({
  makePersonality: vi.fn(async () => ({personality:{name:'Audit Buck',tagline:'Review only',voice:'dry',quirks:[]},birthEntry:'Born',meta:{model:'test',prompt:'test'}})),
  writeDiary: vi.fn(async () => ({entry:'Diary',motif:'city',meta:{model:'test',prompt:'test'}})),
  paintStamp: vi.fn(async () => new Uint8Array([1])),
  writeEulogy: vi.fn(async () => ({eulogy:'Ended',closing:null,meta:{model:'test',prompt:'test'}})),
}));
vi.mock('../worker/email', () => ({sendMail:vi.fn(async () => true),queueMail:vi.fn(async () => 'queued'),retryMail:vi.fn(async () => {})}));
vi.mock('../worker/util', async (actual) => ({...(await actual()),sleep: () => new Promise(() => {})}));
vi.mock('../worker/paypal', async (actual) => ({...(await actual()),createPayout:vi.fn(async () => ({batchId:crypto.randomUUID()}))}));

import * as engine from '../worker/engine';
import { capToken, recoveryHash } from '../worker/util';
import { getBill, getPass } from '../worker/db';
import { createPayout, PayPalError } from '../worker/paypal';
import { sendMail, queueMail } from '../worker/email';
import { runCron } from '../worker/cron';
import { publicBill } from '../worker/views';
import * as ai from '../worker/ai';

const ctx={waitUntil(p:Promise<unknown>){p.catch(()=>{});}};
const place={city:null,region:null,country:null,lat:null,lng:null};
const settled={status:'SUCCESS',itemId:'item1',transactionId:'txn1',error:null};
let db:DB,env:any;
function bill(status='holding') {
  db.sqlite.prepare("INSERT INTO bills(id,seq,serial,status,creator_email,holder_pass_id,holder_since,created_at,wild_since) VALUES('b',1,'FWP-0001',?,'creator@example.com',?,?,?,?)").run(status,status==='holding'?'holder':null,Date.now(),Date.now(),Date.now());
  db.sqlite.prepare("INSERT INTO passes(id,bill_id,kind,recipient_email,status,paypal_mode,created_at,settled_at,holder_notified) VALUES('holder','b','pass','holder@example.com','delivered','mock',?,?,1)").run(Date.now(),Date.now());
  return getBill(env,'b');
}
const flush=()=>new Promise(r => setImmediate(r));
beforeEach(()=>{vi.clearAllMocks();vi.mocked(sendMail).mockResolvedValue(true);vi.mocked(createPayout).mockResolvedValue({batchId:crypto.randomUUID()});db=new DB();env={DB:db,TOKEN_SECRET:'review-only',PAYPAL_MODE:'mock',APP_URL:'http://localhost',STAMPS:{put:async()=>{}},EMAIL_MODE:'log'};});

afterEach(flush);

describe('Lifecycle regressions (real SQL, stubbed external services)',()=>{
  it('confirms only the winning contribution when wild releases race',async()=>{
    const snapshot=(await bill())!;
    const raced = await Promise.allSettled([
      engine.contribute(env,ctx,place,snapshot,{words:'red blue green orange',next:null}),
      engine.contribute(env,ctx,place,snapshot,{words:'gold silver bronze copper',next:null}),
    ]);
    const rows=db.sqlite.prepare("SELECT words,idx FROM hops WHERE status='confirmed'").all();
    expect(rows).toHaveLength(1);
    expect(raced.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('rolls back interrupted settlement and safely replays it',async()=>{
    await bill('in_transit');
    db.sqlite.prepare("INSERT INTO passes(id,bill_id,kind,recipient_email,status,paypal_mode,created_at,next_poll_at) VALUES('pending','b','claim','next@example.com','pending','mock',?,?)").run(Date.now(),Date.now());
    db.sqlite.exec("UPDATE bills SET active_pass_id='pending' WHERE id='b'");
    const pass=(await getPass(env,'pending'))!;
    db.failNextBatch=true;
    await expect(engine.applyPayoutState(env,ctx,pass,settled)).rejects.toThrow('Injected');
    await engine.applyPayoutState(env,ctx,pass,settled);
    await runCron(env,ctx);
    const after=(await getBill(env,'b'))!;
    const pending=db.sqlite.prepare("SELECT count(*) n FROM passes WHERE status='pending'").get();
    expect(after.status).toBe('holding');expect(pending?.n).toBe(0);
  });
  it('retries holder mail and marks completion only after success',async()=>{
    await bill();
    db.sqlite.exec("UPDATE passes SET holder_notified=0,settled_at=1 WHERE id='holder'");
    vi.mocked(sendMail).mockResolvedValue(false);
    await engine.afterDelivery(env,'holder');
    await engine.afterDelivery(env,'holder');
    await runCron(env,ctx);
    expect(vi.mocked(sendMail).mock.calls.filter(([,m]) => m.to === 'holder@example.com')).toHaveLength(3);expect((await getPass(env,'holder'))!.holder_notified).toBe(0);
    vi.mocked(sendMail).mockResolvedValue(true);
    await engine.afterDelivery(env,'holder');
    expect((await getPass(env,'holder'))!.holder_notified).toBe(1);
  });
  it('returns a paid mint and creator key when the first recipient is rejected',async()=>{
    vi.mocked(createPayout).mockRejectedValue(new PayPalError(400,'invalid recipient'));
    const input={orderId:'MOCKORDER-audit',recoveryKey:'a'.repeat(32),creatorEmail:'creator@example.com',words:'red blue green orange',firstRecipient:'bad@example.com'};
    await env.DB.prepare("INSERT INTO checkout_orders(order_id,recovery_hash,paypal_mode,purpose,created_at) VALUES (?,?,'mock','mint',?)").bind(input.orderId,await recoveryHash(input.recoveryKey),Date.now()).run();
    const out = await engine.mintBill(env,ctx,place,input);
    expect(out.creatorToken).toBeTruthy();
    expect(await engine.mintBill(env,ctx,place,input)).toEqual(out);
    await expect(engine.mintBill(env,ctx,place,{...input,recoveryKey:'b'.repeat(32)})).rejects.toThrow('original checkout');
    await flush();
    const minted=db.sqlite.prepare('SELECT serial,status,checkout_order_id FROM bills').all();
    const creatorEmailSent=vi.mocked(queueMail).mock.calls.some(([,m])=>m.kind==='creator');
    expect(minted).toHaveLength(1);expect(creatorEmailSent).toBe(true);expect(minted[0].status).toBe('wild');
  });
  it('keeps platform-funded repeated claims in explicit mock mode',async()=>{
    await bill('wild');
    for(let n=0;n<3;n++){
      await engine.claimFromWild(env,ctx,(await getBill(env,'b'))!,'repeat@example.com');
      const pass=await env.DB.prepare("SELECT * FROM passes WHERE status='pending'").first();
      await engine.applyPayoutState(env,ctx,pass,{...settled,itemId:'item'+n});
      await engine.declineBill(env,ctx,(await getBill(env,'b'))!);
    }
    const paid=db.sqlite.prepare("SELECT count(*) n FROM passes WHERE kind='claim' AND status='delivered'").get();
    expect(paid?.n).toBe(3);expect((await getBill(env,'b'))!.word_count).toBe(0);
  });
  it('discards an obsolete eulogy after a fresh handoff',async()=>{
    const old=(await bill('wild'))!;
    vi.mocked(ai.writeEulogy).mockImplementationOnce(async()=>{
      db.sqlite.exec("UPDATE bills SET status='holding',holder_pass_id='holder',holder_since=9999999999999,version=version+1 WHERE id='b'");
      return {eulogy:'Ended',closing:null,meta:{model:'test',prompt:'test'}};
    });
    await engine.writeBillsOwnEnding(env,old);
    expect((await getBill(env,'b'))!.status).toBe('holding');
  });
  it('keeps automatic expiry at fourteen days while preserving an explicit admin ending',async()=>{
    const fresh=(await bill('wild'))!;
    expect(await engine.writeBillsOwnEnding(env,fresh)).toBe(false);
    expect((await getBill(env,'b'))!.status).toBe('wild');
    expect(await engine.writeBillsOwnEnding(env,(await getBill(env,'b'))!,true)).toBe(true);
    expect((await getBill(env,'b'))!.status).toBe('eulogized');
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM notification_jobs WHERE kind='end'").get()?.n).toBe(1);
  });
  it('keeps slow payouts reserved until their late success',async()=>{
    await bill('in_transit');
    db.sqlite.prepare("INSERT INTO passes(id,bill_id,kind,recipient_email,status,paypal_mode,created_at,next_poll_at,payout_batch_id) VALUES('late','b','claim','next@example.com','pending','mock',?,1,?)").run(Date.now()-3*3600000,'MOCK'+(Date.now()-3*3600000).toString(36).toUpperCase()+'P');
    db.sqlite.exec("UPDATE bills SET active_pass_id='late' WHERE id='b'");
    const pass=(await getPass(env,'late'))!;
    await engine.advancePass(env,ctx,pass);
    expect((await getPass(env,'late'))!.status).toBe('pending');
    expect((await getBill(env,'b'))!.status).toBe('in_transit');
    await engine.applyPayoutState(env,ctx,(await getPass(env,'late'))!,settled);
    expect((await getPass(env,'late'))!.status).toBe('delivered');
    expect((await getBill(env,'b'))!.status).toBe('holding');
  });
  it('records later returns without rewinding story ownership',async()=>{
    await bill('in_transit');
    db.sqlite.prepare("INSERT INTO passes(id,bill_id,kind,recipient_email,status,paypal_mode,created_at) VALUES('reversed','b','claim','next@example.com','pending','mock',?)").run(Date.now());
    db.sqlite.exec("UPDATE bills SET active_pass_id='reversed' WHERE id='b'");
    await engine.applyPayoutState(env,ctx,(await getPass(env,'reversed'))!,{...settled,status:'UNCLAIMED'});
    await engine.applyPayoutState(env,ctx,(await getPass(env,'reversed'))!,{...settled,status:'RETURNED'});
    expect((await getPass(env,'reversed'))!.paypal_status).toBe('RETURNED');
    expect((await getBill(env,'b'))!.holder_pass_id).toBe('reversed');
  });
  it('preserves a reversal committed while a success handler is still running',async()=>{
    await bill('in_transit');
    db.sqlite.prepare("INSERT INTO passes(id,bill_id,kind,recipient_email,status,paypal_mode,created_at) VALUES('raced','b','claim','next@example.com','pending','mock',?)").run(Date.now());
    db.sqlite.exec("UPDATE bills SET active_pass_id='raced' WHERE id='b'");
    const originalBatch=db.batch.bind(db);
    vi.spyOn(db,'batch').mockImplementationOnce(async statements=>{
      // Another handler wins after this handler reads the pass, before its transaction.
      db.sqlite.exec("UPDATE passes SET status='failed',paypal_status='RETURNED' WHERE id='raced'; UPDATE bills SET status='wild',active_pass_id=NULL WHERE id='b'");
      return originalBatch(statements);
    });
    await engine.applyPayoutState(env,ctx,(await getPass(env,'raced'))!,settled);
    expect((await getPass(env,'raced'))!.paypal_status).toBe('RETURNED');
    expect((await getBill(env,'b'))!.status).toBe('wild');
  });
  it('repairs a legacy failed settlement without sending another payout',async()=>{
    await bill('in_transit');
    db.sqlite.prepare("INSERT INTO passes(id,bill_id,kind,recipient_email,status,paypal_mode,paypal_status,created_at) VALUES('interrupted','b','claim','next@example.com','failed','mock','FAILED',?)").run(Date.now());
    db.sqlite.exec("UPDATE bills SET active_pass_id='interrupted' WHERE id='b'");
    await runCron(env,ctx);
    expect((await getBill(env,'b'))!.status).toBe('wild');
    expect((await getBill(env,'b'))!.active_pass_id).toBeNull();
    expect(createPayout).not.toHaveBeenCalled();
  });

  it('backfills real contributions on a seeded bill',async()=>{
    await bill();
    db.sqlite.exec("UPDATE bills SET is_seed=1 WHERE id='b'; INSERT INTO hops(id,bill_id,idx,status,words,content_words,received_pass_id,created_at,confirmed_at) VALUES('real-hop','b',1,'confirmed','red blue green orange',4,'holder',1,1)");
    await runCron(env,ctx);
    expect(ai.paintStamp).toHaveBeenCalledTimes(1);
    const skipped=db.sqlite.prepare("SELECT stamp_status,diary_done,followers_notified FROM hops WHERE id='real-hop'").get();
    db.sqlite.exec("UPDATE bills SET is_seed=0 WHERE id='b'");
    await runCron(env,ctx);
    expect(ai.paintStamp).toHaveBeenCalledTimes(1);
  });
  it('paginates every hop of a 5001-hop story',async()=>{
    await bill('wild');
    db.sqlite.exec("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<5001) INSERT INTO hops(id,bill_id,idx,status,words,content_words,created_at,confirmed_at) SELECT 'h'||i,'b',i,'confirmed','red blue green orange',4,1,1 FROM n; UPDATE bills SET hop_count=5001,word_count=20004 WHERE id='b'");
    const view=await publicBill(env,(await getBill(env,'b'))!);
    expect(view.hops).toHaveLength(200);expect(view.hopCount).toBe(5001);expect(view.hops.at(-1)?.idx).toBe(5001);
    const seen = new Set(view.hops.map(h => h.idx));
    let page=view;
    while(page.history.olderBefore !== null) {
      page=await publicBill(env,(await getBill(env,'b'))!,{before:page.history.olderBefore});
      page.hops.forEach(h => {expect(seen.has(h.idx)).toBe(false);seen.add(h.idx);});
    }
    expect(seen.size).toBe(5001);
    const next=await publicBill(env,(await getBill(env,'b'))!,{after:page.history.newerAfter!});
    expect(next.hops[0].idx).toBe(2);
    expect((await publicBill(env,(await getBill(env,'b'))!,{after:999999})).hops.at(-1)?.idx).toBe(5001);
    expect((await publicBill(env,(await getBill(env,'b'))!,{before:0})).hops[0].idx).toBe(1);
    db.sqlite.exec("UPDATE hops SET city='Paris',country='FR' WHERE idx=1; UPDATE hops SET city='New York',country='US' WHERE idx=5001; UPDATE bills SET status='holding',holder_pass_id='holder' WHERE id='b'");
    const earlier=await publicBill(env,(await getBill(env,'b'))!,{after:0});
    expect(earlier.placeCount).toBe(2);
    expect(earlier.holderPlace).toContain('New York');
  });

  it('leaves a wild bill claimable if reservation is interrupted',async()=>{
    const snapshot=(await bill('wild'))!;
    db.failNextBatch=true;
    await expect(engine.claimFromWild(env,ctx,snapshot,'reader@example.com')).rejects.toThrow('Injected');
    expect((await getBill(env,'b'))!.status).toBe('wild');
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM passes WHERE kind='claim'").get()?.n).toBe(0);
    expect(createPayout).not.toHaveBeenCalled();
  });
  it('resumes a captured mint after atomic initialization fails',async()=>{
    const input={orderId:'MOCKORDER-resume',recoveryKey:'r'.repeat(32),creatorEmail:'creator@example.com',words:'amber robots chase comets',firstRecipient:null};
    await env.DB.prepare("INSERT INTO checkout_orders(order_id,recovery_hash,paypal_mode,purpose,created_at) VALUES (?,?,'mock','mint',?)")
      .bind(input.orderId,await recoveryHash(input.recoveryKey),Date.now()).run();
    db.failNextBatch=true;
    await expect(engine.mintBill(env,ctx,place,input)).rejects.toThrow('Injected');
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM bills").get()?.n).toBe(0);
    const out=await engine.mintBill(env,ctx,place,input);
    const replay=await engine.mintBill(env,ctx,place,input);
    expect(replay).toEqual(out);
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM bills").get()?.n).toBe(1);
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM hops WHERE status='confirmed'").get()?.n).toBe(1);
  });
  it('retries interrupted diary work without claiming it completed',async()=>{
    await bill('wild');
    db.sqlite.exec("INSERT INTO hops(id,bill_id,idx,status,words,content_words,created_at,confirmed_at) VALUES('retry-hop','b',1,'confirmed','amber robots chase comets',4,1,1)");
    vi.mocked(ai.writeDiary).mockRejectedValueOnce(new Error('AI interruption'));
    await expect(engine.runHopEffects(env,'retry-hop')).rejects.toThrow('interruption');
    expect(db.sqlite.prepare("SELECT diary_done,fx_lease_until FROM hops WHERE id='retry-hop'").get()).toMatchObject({diary_done:0,fx_lease_until:0});
    await engine.runHopEffects(env,'retry-hop');
    await engine.runHopEffects(env,'retry-hop');
    expect(db.sqlite.prepare("SELECT COUNT(*) n FROM diary WHERE hop_id='retry-hop'").get()?.n).toBe(1);
  });
  it('requires inbox confirmation and preserves private preferences and opt-outs',async()=>{
    const b=(await bill('wild'))!;
    await engine.follow(env,b,'reader@example.com','every_hop');
    const f=db.sqlite.prepare("SELECT * FROM follows WHERE email='reader@example.com'").get()!;
    expect(f.verified).toBe(0);
    expect((await getBill(env,'b'))!.follower_count).toBe(0);
    const {default: worker}=await import('../worker/index');
    const token=await capToken(env,'follow',String(f.id));
    const save=(preference:string)=>worker.fetch(new Request(`http://localhost/api/follows/${f.id}`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({t:token,preference})}),env,ctx);
    expect((await save('every_hop')).status).toBe(200);
    expect((await getBill(env,'b'))!.follower_count).toBe(1);
    await engine.follow(env,b,'reader@example.com','on_end');
    expect(db.sqlite.prepare("SELECT preference FROM follows WHERE id=?").get(f.id)?.preference).toBe('every_hop');
    expect((await save('unfollow')).status).toBe(200);
    const calls=vi.mocked(queueMail).mock.calls.length;
    await engine.follow(env,b,'reader@example.com','on_end');
    expect(queueMail).toHaveBeenCalledTimes(calls);
    expect(db.sqlite.prepare("SELECT verified,opted_out FROM follows WHERE id=?").get(f.id)).toMatchObject({verified:0,opted_out:1});
  });
  it('queues follower updates across multiple pages without the old 500-person cutoff',async()=>{
    await bill('complete');
    db.sqlite.exec("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<601) INSERT INTO follows(id,bill_id,email,preference,created_at) SELECT printf('f%04d',i),'b','reader'||i||'@example.com','on_end',1 FROM n; INSERT INTO notification_jobs(id,bill_id,kind,details) VALUES('end:b:end','b','end','{}')");
    for(let page=0;page<7;page++) await engine.runNotificationJobs(env);
    expect(queueMail).toHaveBeenCalledTimes(601);
    expect(new Set(vi.mocked(queueMail).mock.calls.map(([,m])=>m.deliveryKey)).size).toBe(601);
    expect(db.sqlite.prepare("SELECT done FROM notification_jobs WHERE id='end:b:end'").get()?.done).toBe(1);
    await engine.runNotificationJobs(env);
    expect(queueMail).toHaveBeenCalledTimes(601);
  });
  it('rejects malformed request bodies with 400 before a payment is created',async()=>{
    const {default: worker}=await import('../worker/index');
    env.RL_WRITE={limit:async()=>({success:true})};
    const request=(payload:unknown)=>worker.fetch(new Request('http://localhost/api/bills',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),env,ctx);
    expect((await request({words:42})).status).toBe(400);
    expect((await request({words:'amber robots chase comets',creatorEmail:['bad']})).status).toBe(400);
    expect(createPayout).not.toHaveBeenCalled();
  });

});
