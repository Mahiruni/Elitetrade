import test from 'node:test';
import assert from 'node:assert/strict';
import {marketDetails} from '../src/market-view.mjs';
test('market presentation bounds and allowlists broker candles and pending orders',()=>{
 const candle={time:'2026-10-04T12:00:00Z',open:10,high:12,low:9,close:11,token:'private'};
 const result=marketDetails({candles:[candle,candle,{...candle,open:Infinity},{...candle,time:'bad'},{...candle,low:13}],orders:[{id:1,symbol:'XAUUSD',volume:.01,openPrice:Infinity,password:'secret',type:'ORDER_TYPE_BUY_LIMIT'},null]},'15m');
 assert.deepEqual(result,{timeframe:'15m',candles:[{time:'2026-10-04T12:00:00.000Z',open:10,high:12,low:9,close:11}],orders:[{id:'1',symbol:'XAUUSD',type:'ORDER_TYPE_BUY_LIMIT',volume:.01}]});
 assert.deepEqual(marketDetails({},'5m'),{timeframe:'5m',candles:[],orders:null});
 assert.deepEqual(marketDetails({orders:[]},'5m').orders,[]);
});
