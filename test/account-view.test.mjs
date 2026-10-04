import test from 'node:test';
import assert from 'node:assert/strict';
import {accountDetails} from '../src/account-view.mjs';
test('account presentation exposes finite broker values without credentials or inferred account types',()=>{
 const result=accountDetails({accountType:'real',password:'never-expose',positions:[{id:'123',symbol:'XAUUSD',type:'POSITION_TYPE_BUY',volume:.01,profit:-3.2,openPrice:Infinity,password:'private',metadata:{token:'private'}},null]});
 assert.deepEqual(result,{accountType:'real',positions:[{id:'123',symbol:'XAUUSD',type:'POSITION_TYPE_BUY',volume:.01,profit:-3.2}]});
 assert.deepEqual(accountDetails({accountType:'guessed',positions:null}),{});
 assert.deepEqual(accountDetails({positions:[]}),{positions:[]});
});
