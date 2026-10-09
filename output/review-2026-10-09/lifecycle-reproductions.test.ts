import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

vi.mock('../../worker/ai', () => ({
  makePersonality: vi.fn(async () => ({personality:{name:'Audit Buck',tagline:'Review only',voice:'dry',quirks:[]},birthEntry:'Born',meta:{model:'test',prompt:'test'}})),
  writeDiary: vi.fn(async () => ({entry:'Diary',motif:'city',meta:{model:'test',prompt:'test'}})),
  paintStamp: vi.fn(async () => new Uint8Array([1])),
  writeEulogy: vi.fn(async () => ({eulogy:'Ended',closing:null,meta:{model:'test',prompt:'test'}})),
}));
vi.mock('../../worker/email', () => ({sendMail:vi.fn(async () => true)}));
vi.mock('../../worker/util', async (actual) => ({...(await actual()),sleep: () => new Promise(() => {})}));
vi.mock('../../worker/paypal', async (actual) => ({...(await actual()),createPayout:vi.fn(async () => ({batchId:crypto.randomUUID()}))}));

import * as engine from '../../worker/engine';
import { getBill, getPass } from '../../worker/db';
import { createPayout, PayPalError } from '../../worker/paypal';
import { sendMail } from '../../worker/email';
import { runCron } from '../../worker/cron';
import { publicBill } from '../../worker/views';
import * as ai from '../../worker/ai';

class Statement {
  constructor(public owner:DB,public sql:string,public args:any[] = []) {}
  bind(...args:any[]) { return new Statement(this.owner,this.sql,args); }
  async first() { return this.owner.sqlite.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return {results:this.owner.sqlite.prepare(this.sql).all(...this.args)}; }
  execRun() { const result=this.owner.sqlite.prepare(this.sql).run(...this.args);return {meta:{changes:Number(result.changes)}}; }
  async run() { return this.execRun(); }
}
class DB {
  sqlite = new DatabaseSync(':memory:');
  failNextBatch = false;
  constructor() { for(const f of ['0001_init.sql','0002_inbox.sql','0003_send_back.sql']) this.sqlite.exec(readFileSync(new URL('../../migrations/'+f,import.meta.url),'utf8')); }
  prepare(sql:string) { return new Statement(this,sql); }
  async batch(stmts:Statement[]) {
    if(this.failNextBatch){this.failNextBatch=false;throw new Error('Injected D1 interruption');}
    this.sqlite.exec('BEGIN');
    try { const results=stmts.map(s => s.execRun()); this.sqlite.exec('COMMIT');return results; }
    catch(e) {this.sqlite.exec('ROLLBACK');throw e;}
  }
}
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

describe('Isolated lifecycle reproductions (no live services)',()=>{
  it('reproduces two confirmed contributions from one holder when wild releases race',async()=>{
    const snapshot=(await bill())!;
    await Promise.all([
      engine.contribute(env,ctx,place,snapshot,{words:'red blue green orange',next:null}),
      engine.contribute(env,ctx,place,snapshot,{words:'gold silver bronze copper',next:null}),
    ]);
    const rows=db.sqlite.prepare("SELECT words,idx FROM hops WHERE status='confirmed'").all();
    console.log('DOUBLE_RELEASE',JSON.stringify(rows));
    expect(rows).toHaveLength(2);
  });
  it('reproduces a permanently stuck delivered pass after interruption between writes',async()=>{
    await bill('in_transit');
    db.sqlite.prepare("INSERT INTO passes(id,bill_id,kind,recipient_email,status,paypal_mode,created_at,next_poll_at) VALUES('pending','b','claim','next@example.com','pending','mock',?,?)").run(Date.now(),Date.now());
    const pass=(await getPass(env,'pending'))!;
    db.failNextBatch=true;
    await expect(engine.applyPayoutState(env,ctx,pass,settled)).rejects.toThrow('Injected');
    await engine.applyPayoutState(env,ctx,pass,settled);
    await runCron(env,ctx);
    const after=(await getBill(env,'b'))!;
    const pending=db.sqlite.prepare("SELECT count(*) n FROM passes WHERE status='pending'").get();
    console.log('INTERRUPTED_DELIVERY',JSON.stringify({billStatus:after.status,passStatus:(await getPass(env,'pending'))!.status,pending}));
    expect(after.status).toBe('in_transit');expect(pending?.n).toBe(0);
  });
  it('reproduces lost holder email with a notification marked complete',async()=>{
    await bill();
    db.sqlite.exec("UPDATE passes SET holder_notified=0,settled_at=1 WHERE id='holder'");
    vi.mocked(sendMail).mockResolvedValue(false);
    await engine.afterDelivery(env,'holder');
    await engine.afterDelivery(env,'holder');
    await runCron(env,ctx);
    console.log('EMAIL_FAILURE',JSON.stringify({attempts:vi.mocked(sendMail).mock.calls.length,notified:(await getPass(env,'holder'))!.holder_notified}));
    expect(sendMail).toHaveBeenCalledTimes(1);expect((await getPass(env,'holder'))!.holder_notified).toBe(1);
  });
  it('reproduces paid mint returning error and omitting creator-key email on first payout rejection',async()=>{
    vi.mocked(createPayout).mockRejectedValue(new PayPalError(400,'invalid recipient'));
    await expect(engine.mintBill(env,ctx,place,{orderId:'MOCKORDER-audit',creatorEmail:'creator@example.com',words:'red blue green orange',firstRecipient:'bad@example.com'})).rejects.toThrow('couldn');
    await flush();
    const minted=db.sqlite.prepare('SELECT serial,status,checkout_order_id FROM bills').all();
    const creatorEmailSent=vi.mocked(sendMail).mock.calls.some(([,m])=>m.kind==='creator');
    console.log('PAID_MINT_ERROR',JSON.stringify({minted,creatorEmailSent}));
    expect(minted).toHaveLength(1);expect(creatorEmailSent).toBe(false);
  });
  it('reproduces repeated payouts to same claimer without any new words or checkout',async()=>{
    await bill('wild');
    for(let n=0;n<3;n++){
      await engine.claimFromWild(env,ctx,(await getBill(env,'b'))!,'repeat@example.com');
      const pass=await env.DB.prepare("SELECT * FROM passes WHERE status='pending'").first();
      await engine.applyPayoutState(env,ctx,pass,{...settled,itemId:'item'+n});
      await engine.declineBill(env,ctx,(await getBill(env,'b'))!);
    }
    const paid=db.sqlite.prepare("SELECT count(*) n FROM passes WHERE kind='claim' AND status='delivered'").get();
    console.log('CLAIM_RETURN_LOOP',JSON.stringify({payouts:paid?.n,words:(await getBill(env,'b'))!.word_count,billStatus:(await getBill(env,'b'))!.status}));
    expect(paid?.n).toBe(3);expect((await getBill(env,'b'))!.word_count).toBe(0);
  });
  it('reproduces stale eulogy closing a bill after a fresh claim has settled',async()=>{
    const old=(await bill('wild'))!;
    vi.mocked(ai.writeEulogy).mockImplementationOnce(async()=>{
      db.sqlite.exec("UPDATE bills SET status='holding',holder_pass_id='holder',holder_since=9999999999999,version=version+1 WHERE id='b'");
      return {eulogy:'Ended',closing:null,meta:{model:'test',prompt:'test'}};
    });
    await engine.writeBillsOwnEnding(env,old);
    console.log('STALE_EULOGY',JSON.stringify({status:(await getBill(env,'b'))!.status}));
    expect((await getBill(env,'b'))!.status).toBe('eulogized');
  });
  it('reproduces a late successful payout remaining failed after the local timeout',async()=>{
    await bill('in_transit');
    db.sqlite.prepare("INSERT INTO passes(id,bill_id,kind,recipient_email,status,paypal_mode,created_at,next_poll_at,payout_batch_id) VALUES('late','b','claim','next@example.com','pending','mock',?,1,?)").run(Date.now()-3*3600000,'MOCK'+(Date.now()-3*3600000).toString(36).toUpperCase()+'P');
    const pass=(await getPass(env,'late'))!;
    await engine.advancePass(env,ctx,pass);
    await engine.applyPayoutState(env,ctx,(await getPass(env,'late'))!,settled);
    console.log('LATE_SUCCESS',JSON.stringify({billStatus:(await getBill(env,'b'))!.status,passStatus:(await getPass(env,'late'))!.status,paypalStatus:(await getPass(env,'late'))!.paypal_status}));
    expect((await getPass(env,'late'))!.status).toBe('failed');
    expect((await getBill(env,'b'))!.status).toBe('wild');
  });
  it('reproduces returned payout leaving the stored receipt marked successful',async()=>{
    await bill('in_transit');
    db.sqlite.prepare("INSERT INTO passes(id,bill_id,kind,recipient_email,status,paypal_mode,created_at) VALUES('reversed','b','claim','next@example.com','pending','mock',?)").run(Date.now());
    await engine.applyPayoutState(env,ctx,(await getPass(env,'reversed'))!,{...settled,status:'UNCLAIMED'});
    await engine.applyPayoutState(env,ctx,(await getPass(env,'reversed'))!,{...settled,status:'RETURNED'});
    console.log('IGNORED_RETURN',JSON.stringify({storedPaypalStatus:(await getPass(env,'reversed'))!.paypal_status}));
    expect((await getPass(env,'reversed'))!.paypal_status).toBe('UNCLAIMED');
  });

  it('reproduces cron skipping a real contribution on a seeded bill',async()=>{
    await bill();
    db.sqlite.exec("UPDATE bills SET is_seed=1 WHERE id='b'; INSERT INTO hops(id,bill_id,idx,status,words,content_words,received_pass_id,created_at,confirmed_at) VALUES('real-hop','b',1,'confirmed','red blue green orange',4,'holder',1,1)");
    await runCron(env,ctx);
    expect(ai.paintStamp).not.toHaveBeenCalled();
    const skipped=db.sqlite.prepare("SELECT stamp_status,diary_done,followers_notified FROM hops WHERE id='real-hop'").get();
    db.sqlite.exec("UPDATE bills SET is_seed=0 WHERE id='b'");
    await runCron(env,ctx);
    console.log('SEED_BACKFILL',JSON.stringify({skipped,paintCallsAfterUnseeding:vi.mocked(ai.paintStamp).mock.calls.length}));
    expect(ai.paintStamp).toHaveBeenCalledTimes(1);
  });
  it('reproduces silent story truncation at 5000 hops',async()=>{
    await bill('wild');
    db.sqlite.exec("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<5001) INSERT INTO hops(id,bill_id,idx,status,words,content_words,created_at,confirmed_at) SELECT 'h'||i,'b',i,'confirmed','red blue green orange',4,1,1 FROM n; UPDATE bills SET hop_count=5001,word_count=20004 WHERE id='b'");
    const view=await publicBill(env,(await getBill(env,'b'))!);
    console.log('STORY_LIMIT',JSON.stringify({count:view.hopCount,rendered:view.hops.length,last:view.hops.at(-1)?.idx}));
    expect(view.hops).toHaveLength(5000);expect(view.hopCount).toBe(5001);
  });

});
