import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawnSync} from 'node:child_process';
import {createAirtableApi} from '../../scripts/gate8/airtable-api.mjs';
import {observeRead,ownershipReadPolicy,observerHelperTimeoutMs} from '../../scripts/gate8/retry-read.mjs';
test('worker ownership GET retries two real aborted HTTP reads, then preserves record identity',async()=>{
 let reads=0;const delays=[];const deadlines=[];const controllers=[];
 const server=http.createServer((req,res)=>{assert.equal(req.url,'/fixture-record');assert.equal(req.method,'GET');reads++;if(reads<3){const controller=controllers.at(-1);setTimeout(()=>controller.abort(new DOMException('deliberate timeout','TimeoutError')),10);return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'fixture-record',fields:{Status:'Blocked','Claimed By':'preserved-owner'}}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const api=createAirtableApi({base:`http://127.0.0.1:${server.address().port}`,token:'local-test-only',pause:async ms=>delays.push(ms),signalForAttempt:ms=>{deadlines.push(ms);const controller=new AbortController();controllers.push(controller);return AbortSignal.any([controller.signal,AbortSignal.timeout(5000)]);}});
  const record=await api('GET','/fixture-record');assert.equal(reads,3);assert.deepEqual(delays,[5000,15000]);assert.deepEqual(deadlines,[20000,20000,20000]);assert.equal(record.fields.Status,'Blocked');assert.equal(record.fields['Claimed By'],'preserved-owner');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('worker permanent timeout exhausts exactly three GETs',async()=>{
 let calls=0;const delays=[];const api=createAirtableApi({base:'http://fixture',token:'fake',pause:async ms=>delays.push(ms),fetchImpl:async()=>{calls++;throw new DOMException('deadline','TimeoutError');}});
 await assert.rejects(api('GET','/one-record'),/deadline/);assert.equal(calls,3);assert.deepEqual(delays,[5000,15000]);
});
test('GET permissions, missing record and invalid JSON do not retry',async()=>{
 for(const status of [401,403,404]){let calls=0;const api=createAirtableApi({base:'http://fixture',token:'fake',pause:async()=>assert.fail('no retry'),fetchImpl:async()=>{calls++;return {ok:false,status};}});await assert.rejects(api('GET','/one'),new RegExp(String(status)));assert.equal(calls,1);}
 let calls=0;const api=createAirtableApi({base:'http://fixture',token:'fake',pause:async()=>assert.fail('no retry'),fetchImpl:async()=>{calls++;return {ok:true,json:async()=>{throw new SyntaxError('invalid JSON');}};}});await assert.rejects(api('GET','/one'),/invalid JSON/);assert.equal(calls,1);
});
test('PATCH and POST timeout or server failure are never retried',async()=>{
 for(const method of ['PATCH','POST'])for(const timeout of [true,false]){let calls=0;const api=createAirtableApi({base:'http://fixture',token:'fake',pause:async()=>assert.fail('writes must not retry'),fetchImpl:async()=>{calls++;if(timeout)throw new DOMException('deadline','TimeoutError');return {ok:false,status:503};}});await assert.rejects(api(method,'/one',{Status:'Blocked'}));assert.equal(calls,1);}
});
test('observer catches a real spawnSync ETIMEDOUT and retries to success',async()=>{
 let calls=0;const delays=[];const result=await observeRead(async()=>{calls++;if(calls<3){const child=spawnSync(process.execPath,['-e','setTimeout(()=>{},10000)'],{timeout:30});assert.equal(child.error.code,'ETIMEDOUT');throw child.error;}return 'observed progress';},{pause:async ms=>delays.push(ms)});
 assert.equal(result,'observed progress');assert.equal(calls,3);assert.deepEqual(delays,[1000,2000]);
});
test('observer persistent outer timeout and nested connect timeout stay bounded',async()=>{
 for(const make of [()=>Object.assign(Error('spawnSync ETIMEDOUT'),{code:'ETIMEDOUT'}),()=>Object.assign(TypeError('fetch failed'),{cause:Object.assign(Error('connect deadline'),{code:'UND_ERR_CONNECT_TIMEOUT'})})]){let calls=0;await assert.rejects(observeRead(async()=>{calls++;throw make();},{pause:async()=>{}}));assert.equal(calls,3);}
});
test('wrapper budget covers the complete worker read policy',()=>{
 const budget=ownershipReadPolicy.attempts*ownershipReadPolicy.deadlineMs+ownershipReadPolicy.backoffMs.reduce((a,b)=>a+b,0);
 assert.equal(budget,80000);assert.ok(observerHelperTimeoutMs>budget);
});
