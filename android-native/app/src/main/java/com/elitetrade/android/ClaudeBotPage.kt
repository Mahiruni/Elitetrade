package com.elitetrade.android

import androidx.compose.foundation.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneOffset
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.max
import kotlin.math.min

private val cbGold=Color(0xFFE6B965)
private val cbPanel=Color(0xFF192330)
private val cbField=Color(0xFF101A26)
private val cbBorder=Color(0xFF344152)
private val cbText=Color(0xFFF3F5FA)
private val cbMuted=Color(0xFFACBACC)
private val cbGreen=Color(0xFF46D4A9)
private val cbRed=Color(0xFFF68E98)
private val titles=listOf("Trend · 1h","Support & resistance","5-second move","Momentum",
    "Trading session","EMA 50 / 200","Price at level","RSI · 14")
private data class CandleBar(val time:Long,val open:Double,val high:Double,val low:Double,val close:Double)
private data class AnalysisCheck(val title:String,val description:String,val available:Boolean)

private fun utcMillis(raw:String):Long?=runCatching{Instant.parse(raw).toEpochMilli()}.getOrNull()
private fun displayValue(n:Double):String=if(n.isFinite())NumberFormat.getNumberInstance(Locale.US).apply{
    maximumFractionDigits=6
}.format(n) else "—"
private fun readCandles(data:JSONObject):List<CandleBar>{
    val input=data.optJSONArray("candles")?:return emptyList()
    return (0 until input.length()).mapNotNull{index->
        val c=input.optJSONObject(index)?:return@mapNotNull null
        val time=utcMillis(c.optString("time"))?:return@mapNotNull null
        val o=c.optDouble("open",Double.NaN)
        val h=c.optDouble("high",Double.NaN)
        val l=c.optDouble("low",Double.NaN)
        val close=c.optDouble("close",Double.NaN)
        if(listOf(o,h,l,close).any{!it.isFinite()||it<=0}||
           h<max(o,max(l,close))||l>min(o,min(h,close)))null
        else CandleBar(time,o,h,l,close)
    }.sortedBy{it.time}.distinctBy{it.time}
}
private fun quoteFresh(data:JSONObject?,now:Long):Boolean{
    val t=utcMillis(data?.optString("updatedAt").orEmpty())?:return false
    return t<=now+5000&&now-t<60000
}
private fun ema(data:List<Double>,period:Int):Double?{
    if(data.size<period)return null
    var avg=data.take(period).average()
    for(i in period until data.size)avg+=(data[i]-avg)*2/(period+1)
    return avg
}
private fun rsi(data:List<Double>):Double?{
    if(data.size<15)return null
    var gain=0.0;var loss=0.0
    for(i in 1..14){val d=data[i]-data[i-1];gain+=max(d,0.0);loss+=max(-d,0.0)}
    gain/=14;loss/=14
    for(i in 15 until data.size){
        val d=data[i]-data[i-1]
        gain=(gain*13+max(d,0.0))/14;loss=(loss*13+max(-d,0.0))/14
    }
    return if(loss==0.0){if(gain==0.0)50.0 else 100.0}else 100.0-100.0/(1.0+gain/loss)
}
private fun analyse(data:JSONObject,now:Long):List<AnalysisCheck>{
    val tf=data.optString("timeframe")
    val minutes=tf.removeSuffix("m").toIntOrNull()?.takeIf{tf.endsWith("m")&&it>0}?:0
    val interval=minutes*60000L
    val closed=if(interval>0)readCandles(data).filter{it.time+interval<=now}else emptyList()
    val values=closed.map{it.close}
    val latest=closed.lastOrNull()
    val hourly=if(minutes>0&&60%minutes==0)closed.groupBy{it.time/3600000L}.toSortedMap()
        .filter{(hour,group)->
            group.size==60/minutes&&group.first().time==hour*3600000L&&
                group.zipWithNext().all{(a,b)->b.time-a.time==interval}
        }.values.toList()else emptyList()
    val trend=if(hourly.size>=3){
        val a=hourly.last().last().close;val b=hourly[hourly.lastIndex-1].last().close
        AnalysisCheck(titles[0],(if(a>b)"Rising" else if(a<b)"Falling" else "Flat")+
            " · complete hourly closes",true)
    }else AnalysisCheck(titles[0],"Complete one-hour candle groups unavailable.",false)
    val previous=if(closed.size>=21)closed.takeLast(21).dropLast(1)else emptyList()
    val support=previous.minOfOrNull{it.low}
    val resistance=previous.maxOfOrNull{it.high}
    val levels=if(support!=null&&resistance!=null)AnalysisCheck(titles[1],
        "Support "+displayValue(support)+" · Resistance "+displayValue(resistance),true)
        else AnalysisCheck(titles[1],"Requires at least 21 closed candles.",false)
    val ticks=AnalysisCheck(titles[2],"Unavailable · no verified 5-second price ticks were supplied.",false)
    val change=if(values.size>=6&&values[values.lastIndex-5]>0){
        val pct=(values.last()/values[values.lastIndex-5]-1)*100
        AnalysisCheck(titles[3],"Five-candle change "+"%+.3f".format(Locale.US,pct)+"%",true)
    }else AnalysisCheck(titles[3],"Requires at least six closed candles.",false)
    val session=if(latest!=null){
        val hour=Instant.ofEpochMilli(latest.time).atZone(ZoneOffset.UTC).hour
        AnalysisCheck(titles[4],"%02d:00 UTC".format(Locale.US,hour)+
            " · market hours and holidays unverified",true)
    }else AnalysisCheck(titles[4],"Session context unavailable.",false)
    val fast=ema(values,50);val slow=ema(values,200)
    val emas=if(fast!=null&&slow!=null)AnalysisCheck(titles[5],
        "EMA 50 "+displayValue(fast)+" · EMA 200 "+displayValue(slow),true)
        else AnalysisCheck(titles[5],"Needs 200 closed candles (provider may return fewer).",false)
    val reaction=if(latest!=null&&support!=null&&resistance!=null)
        AnalysisCheck(titles[6],if(latest.close>resistance)"Above resistance"
            else if(latest.close<support)"Below support" else "Inside previous 20-candle range",true)
        else AnalysisCheck(titles[6],"Current close and validated levels unavailable.",false)
    val strength=rsi(values)
    val relative=if(strength!=null)AnalysisCheck(titles[7],
        "%.1f".format(Locale.US,strength)+
            (if(strength>70)" · Overbought" else if(strength<30)" · Oversold" else " · Neutral"),true)
        else AnalysisCheck(titles[7],"Requires 15 closed candles.",false)
    return listOf(trend,levels,ticks,change,session,emas,reaction,relative)
}
@Composable
fun ClaudeBotPage(api:EliteApi,bots:List<JSONObject>,accounts:List<JSONObject>,hasAccess:Boolean){
    val scope=rememberCoroutineScope()
    var selectedId by remember{mutableStateOf("")}
    var menu by remember{mutableStateOf(false)}
    var result by remember{mutableStateOf<JSONObject?>(null)}
    var loading by remember{mutableStateOf(false)}
    var step by remember{mutableIntStateOf(0)}
    var checks by remember{mutableStateOf<List<AnalysisCheck>>(emptyList())}
    var problem by remember{mutableStateOf("")}
    var now by remember{mutableLongStateOf(System.currentTimeMillis())}
    LaunchedEffect(bots.map{it.optString("id")}){
        if(bots.none{it.optString("id")==selectedId})selectedId=bots.firstOrNull()?.optString("id").orEmpty()
    }
    LaunchedEffect(result){
        while(result!=null){delay(1000);now=System.currentTimeMillis()}
    }
    val bot=bots.find{it.optString("id")==selectedId}
    val account=accounts.find{it.optString("id")==bot?.optString("account_id")}
    val connected=account?.optString("status")=="connected"
    val fresh=quoteFresh(result,now)
    val side=if(!loading&&problem.isBlank()&&fresh)result?.optJSONObject("signal")?.optString("side").orEmpty() else ""
    val direction=when{
        loading->"ANALYZING…"
        problem.isNotBlank()->"DATA UNAVAILABLE"
        result==null->"READY TO ANALYZE"
        !fresh->"SIGNAL EXPIRED"
        side=="buy"->"HIGHER / BUY"
        side=="sell"->"LOWER / SELL"
        else->"NO TRADE"
    }
    val tone=if(side=="buy")cbGreen else if(side=="sell")cbRed else cbGold
    val candles=remember(result){result?.let(::readCandles).orEmpty()}
    val quote=result?.optJSONObject("quote")
    fun refresh(){
        val chosen=bot?:return
        if(loading)return
        scope.launch{
            loading=true;problem="";step=0;result=null;checks=emptyList()
            try{
                if(!hasAccess)throw ApiProblem("Activate your subscription before requesting broker data.")
                if(!connected)throw ApiProblem("Connect and verify an MT5 account first.")
                val response=api.previewBot(chosen.optString("id"))
                now=System.currentTimeMillis()
                if(!quoteFresh(response,now))throw ApiProblem("Broker quote is stale. No current entry signal can be shown.")
                val evaluated=analyse(response,now)
                result=response
                for(i in evaluated.indices){checks=evaluated.take(i+1);step=i+1;delay(85)}
            }catch(e:Exception){problem=e.message?:"Broker preview unavailable.";result=null;checks=emptyList();step=0}
            finally{loading=false}
        }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())
        .padding(start=16.dp,end=16.dp,top=16.dp,bottom=24.dp),
        verticalArrangement=Arrangement.spacedBy(15.dp)){
        Row(verticalAlignment=Alignment.CenterVertically){
            Column(Modifier.weight(1f)){
                Text("ELITETRADE · SIGNAL INTELLIGENCE",color=cbGold,fontSize=10.sp,fontWeight=FontWeight.Bold)
                Text("ClaudeBot",color=cbText,fontSize=31.sp,fontWeight=FontWeight.ExtraBold)
                Text("Independent market analysis",color=cbMuted,fontSize=12.sp)
            }
            Surface(color=cbGold.copy(alpha=.13f),shape=RoundedCornerShape(20.dp),
                border=BorderStroke(1.dp,cbGold.copy(alpha=.45f))){
                Text("READ-ONLY",Modifier.padding(10.dp),color=cbGold,fontSize=10.sp,fontWeight=FontWeight.Bold)
            }
        }
        Surface(color=cbPanel,shape=RoundedCornerShape(21.dp),border=BorderStroke(1.dp,cbBorder)){
            Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){
                Text("Instrument / configured strategy",color=cbMuted,fontSize=12.sp)
                Box{
                    OutlinedButton(onClick={menu=true},enabled=bots.isNotEmpty()&&!loading,
                        modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(12.dp)){
                        Text(if(bot==null)"No strategy configured"
                            else bot.optString("symbol")+" · "+bot.optString("strategy"),
                            color=cbText,modifier=Modifier.weight(1f),maxLines=1,overflow=TextOverflow.Ellipsis)
                        Icon(Icons.Default.ArrowDropDown,contentDescription=null,tint=cbGold)
                    }
                    DropdownMenu(expanded=menu,onDismissRequest={menu=false}){
                        bots.forEach{b->
                            DropdownMenuItem(text={Text(b.optString("symbol")+" · "+b.optString("name"))},
                                onClick={
                                    selectedId=b.optString("id");menu=false;result=null;checks=emptyList();step=0;problem=""
                                })
                        }
                    }
                }
                Text(if(account==null)"No linked MT5 account"
                    else account.optString("broker")+" · "+account.optString("login")+
                        " · "+account.optString("status"),color=cbMuted,fontSize=11.sp)
                if(!connected)Text("A verified MT5 connection is required.",color=cbGold,fontSize=12.sp)
                Surface(color=tone.copy(alpha=.11f),shape=RoundedCornerShape(19.dp),
                    border=BorderStroke(1.dp,tone.copy(alpha=.5f))){
                    Column(Modifier.fillMaxWidth().padding(vertical=28.dp,horizontal=10.dp),
                        horizontalAlignment=Alignment.CenterHorizontally){
                        Text("STRATEGY SIGNAL",color=cbMuted,fontSize=10.sp)
                        Spacer(Modifier.height(11.dp))
                        Icon(if(side=="buy")Icons.Default.TrendingUp else if(side=="sell")
                            Icons.Default.TrendingDown else Icons.Default.AutoGraph,
                            contentDescription=null,tint=tone,modifier=Modifier.size(41.dp))
                        Spacer(Modifier.height(10.dp))
                        Text(direction,color=cbText,fontSize=25.sp,fontWeight=FontWeight.Black)
                        Spacer(Modifier.height(7.dp))
                        Text(if(loading)"Reviewing broker market data"
                            else if(result==null)"Request a read-only MT5 strategy preview"
                            else if(!fresh)"Quote has expired · refresh required"
                            else "Broker strategy preview · no order sent",color=cbMuted,fontSize=11.sp)
                    }
                }
                Button(onClick={refresh()},enabled=bot!=null&&connected&&hasAccess&&!loading,
                    colors=ButtonDefaults.buttonColors(containerColor=cbGold,contentColor=Color(0xFF111A26)),
                    shape=RoundedCornerShape(13.dp),modifier=Modifier.fillMaxWidth().height(50.dp)){
                    if(loading)CircularProgressIndicator(Modifier.size(18.dp),strokeWidth=2.dp,
                        color=Color(0xFF111A26))
                    else Icon(Icons.Default.Refresh,contentDescription=null)
                    Spacer(Modifier.width(8.dp))
                    Text(if(loading)"Analyzing…" else "Refresh signal",fontWeight=FontWeight.Bold)
                }
                if(problem.isNotBlank())Text(problem,color=cbRed,fontSize=12.sp)
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                    Text("Eight-stage technical review",color=cbText,fontWeight=FontWeight.Bold,fontSize=12.sp)
                    Text(step.toString()+" / 8",color=cbGold,fontSize=12.sp)
                }
                LinearProgressIndicator(progress={step/8f},modifier=Modifier.fillMaxWidth().height(6.dp),
                    color=cbGold,trackColor=cbBorder)
                titles.forEachIndexed{index,title->
                    val check=checks.getOrNull(index)
                    Surface(color=cbField,shape=RoundedCornerShape(13.dp),
                        border=BorderStroke(1.dp,if(check?.available==true)cbGreen.copy(alpha=.6f)
                            else if(loading&&step==index)cbGold else cbBorder)){
                        Row(Modifier.fillMaxWidth().padding(12.dp),
                            horizontalArrangement=Arrangement.spacedBy(12.dp)){
                            Text("%02d".format(Locale.US,index+1),color=cbMuted,fontSize=11.sp)
                            Column(Modifier.weight(1f)){
                                Text(title,color=cbText,fontWeight=FontWeight.Bold,fontSize=13.sp)
                                Text(check?.description ?: if(loading&&step==index)"Evaluating…"
                                    else "Awaiting market data",color=cbMuted,fontSize=11.sp,lineHeight=16.sp)
                            }
                            Text(if(check==null)"·" else if(check.available)"✓" else "—",
                                color=if(check?.available==true)cbGreen else cbMuted)
                        }
                    }
                }
            }
        }
        Surface(color=cbPanel,shape=RoundedCornerShape(20.dp),border=BorderStroke(1.dp,cbBorder)){
            Column(Modifier.padding(14.dp)){
                Text("Broker candlestick chart",color=cbText,fontWeight=FontWeight.Bold,fontSize=15.sp)
                Spacer(Modifier.height(12.dp))
                if(candles.isNotEmpty())CandleChart(candles)
                else Box(Modifier.fillMaxWidth().height(172.dp).background(cbField,RoundedCornerShape(12.dp)),
                    contentAlignment=Alignment.Center){Text("Verified broker candles appear here after analysis.",
                        Modifier.padding(18.dp),color=cbMuted,fontSize=12.sp)}
                Spacer(Modifier.height(9.dp))
                Text("Read-only MT5 candles · "+(result?.optString("timeframe")?:"Not loaded"),
                    color=cbMuted,fontSize=11.sp)
            }
        }
        Surface(color=cbPanel,shape=RoundedCornerShape(20.dp),border=BorderStroke(1.dp,cbBorder)){
            Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                Text("Market readings",color=cbText,fontWeight=FontWeight.Bold,fontSize=15.sp)
                Reading("Bid",displayValue(quote?.optDouble("bid",Double.NaN)?:Double.NaN))
                Reading("Ask",displayValue(quote?.optDouble("ask",Double.NaN)?:Double.NaN))
                Reading("Source",when(result?.optString("accountType")){
                    "demo"->"Demo MT5";"real"->"Live MT5";else->"Unverified"
                })
                Reading("Quote status",if(result==null)"Not loaded" else if(fresh)"Fresh" else "Expired")
                Text("No order is sent by ClaudeBot. Signal previews and technical indicators are not guarantees.",
                    color=cbMuted,fontSize=11.sp,lineHeight=16.sp)
            }
        }
    }
}
@Composable
private fun Reading(label:String,value:String){
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
        Text(label,color=cbMuted,fontSize=12.sp)
        Text(value,color=cbText,fontSize=12.sp,fontWeight=FontWeight.SemiBold)
    }
}
@Composable
private fun CandleChart(data:List<CandleBar>){
    val points=data.takeLast(48)
    val low=points.minOf{it.low}
    val high=points.maxOf{it.high}
    val spread=(high-low).takeIf{it>0}?:max(high*.001,0.001)
    Canvas(Modifier.fillMaxWidth().height(230.dp).background(cbField,RoundedCornerShape(12.dp))
        .padding(10.dp)){
        val step=size.width/points.size
        fun y(v:Double)=((high-v)/spread*size.height.toDouble()*.88+size.height.toDouble()*.06).toFloat()
        points.forEachIndexed{i,c->
            val x=step*(i+.5f)
            val tint=if(c.close>=c.open)cbGreen else cbRed
            drawLine(tint,Offset(x,y(c.high)),Offset(x,y(c.low)),strokeWidth=1.5.dp.toPx())
            drawLine(tint,Offset(x,y(c.open)),Offset(x,y(c.close)),
                strokeWidth=max(2.dp.toPx(),step*.5f))
        }
    }
}
