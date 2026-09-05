const UPSTOX_V3="https://api.upstox.com/v3";
const UPSTOX_V2="https://api.upstox.com/v2";
const n=v=>Number.isFinite(Number(v))?Number(v):null;
const avg=xs=>{const a=xs.filter(v=>Number.isFinite(v));return a.length?a.reduce((s,v)=>s+v,0)/a.length:null;};
function sma(xs,p){return xs.length>=p?avg(xs.slice(-p)):null;}
function ema(xs,p){if(xs.length<p)return[];const k=2/(p+1),out=[avg(xs.slice(0,p))];for(let i=p;i<xs.length;i++)out.push(xs[i]*k+out.at(-1)*(1-k));return out;}
function rsi(xs,p=14){if(xs.length<=p)return null;let g=0,l=0;for(let i=1;i<=p;i++){const d=xs[i]-xs[i-1];if(d>=0)g+=d;else l-=d;}let ag=g/p,al=l/p;for(let i=p+1;i<xs.length;i++){const d=xs[i]-xs[i-1];ag=((ag*(p-1))+Math.max(d,0))/p;al=((al*(p-1))+Math.max(-d,0))/p;}return al===0?100:100-100/(1+ag/al);}
function ret(xs,p){if(xs.length<=p)return null;const old=xs[xs.length-1-p],last=xs.at(-1);return old?((last-old)/old)*100:null;}
function atr(c,p=14){if(c.length<=p)return null;const tr=[];for(let i=1;i<c.length;i++){const pc=c[i-1][4],h=c[i][2],l=c[i][3];if([pc,h,l].every(Number.isFinite))tr.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));}if(tr.length<p)return null;let v=avg(tr.slice(0,p));for(let i=p;i<tr.length;i++)v=((v*(p-1))+tr[i])/p;return v;}
function quote(body,key){const root=body?.data||{},row=root[key]||root[String(key).replace("|",":")]||Object.values(root)[0]||{};return{price:n(row?.last_price??row?.ltp??row?.last_traded_price),previous_close:n(row?.cp??row?.previous_close),volume:n(row?.volume)};}
async function fetchUpstox(base,path,token){const r=await fetch(`${base}${path}`,{headers:{Accept:"application/json",Authorization:`Bearer ${token}`},cache:"no-store"});const text=await r.text();let body={};try{body=JSON.parse(text);}catch{body={raw_text:text};}return{ok:r.ok,status:r.status,body};}
const resolutionCache=new Map();
async function resolveInstrumentKey(isin,token){
 const clean=String(isin||"").trim().toUpperCase();
 if(!clean)return null;
 if(resolutionCache.has(clean))return resolutionCache.get(clean);
 const r=await fetchUpstox(UPSTOX_V2,`/instruments/search?query=${encodeURIComponent(clean)}&exchanges=NSE&segments=EQ&instrument_types=EQ&page_number=1&records=30`,token);
 const rows=Array.isArray(r.body?.data)?r.body.data:[];
 const match=rows.find(x=>String(x?.isin||"").toUpperCase()===clean&&String(x?.segment||"").toUpperCase()==="NSE_EQ"&&String(x?.instrument_type||"").toUpperCase()==="EQ")||rows.find(x=>String(x?.isin||"").toUpperCase()===clean&&String(x?.segment||"").toUpperCase()==="NSE_EQ")||rows.find(x=>String(x?.instrument_key||"").toUpperCase().startsWith("NSE_EQ|"));
 const key=match?.instrument_key||null;
 if(key)resolutionCache.set(clean,key);
 return key;
}
async function getMarketData(key,toDate,fromDate,token){
 const direct=async k=>{
   const q3=await fetchUpstox(UPSTOX_V3,`/market-quote/ltp?instrument_key=${encodeURIComponent(k)}`,token);
   const h3=await fetchUpstox(UPSTOX_V3,`/historical-candle/${encodeURIComponent(k)}/days/1/${toDate}/${fromDate}`,token);
   let q=q3,h=h3,source="v3";
   const candles3=h3.body?.data?.candles||[];
   if(!q3.ok||candles3.length<30){
     const q2=await fetchUpstox(UPSTOX_V2,`/market-quote/ltp?instrument_key=${encodeURIComponent(k)}`,token);
     const h2=await fetchUpstox(UPSTOX_V2,`/historical-candle/${encodeURIComponent(k)}/day/${toDate}/${fromDate}`,token);
     const candles2=h2.body?.data?.candles||[];
     if(q2.ok||candles2.length>=30){q=q2.ok?q2:q3;h=candles2.length>=30?h2:h3;source="v2_fallback";}
   }
   return{q,h,source,key:k};
 };
 let result=await direct(key);
 const directCandles=result.h.body?.data?.candles||[];
 if((!result.q.ok&&!result.h.ok)||directCandles.length<30){
   const resolved=await resolveInstrumentKey(key.includes("|")?key.split("|").at(-1):key,token);
   if(resolved&&resolved!==key){
     const retry=await direct(resolved);
     const retryCandles=retry.h.body?.data?.candles||[];
     if(retry.q.ok||retry.h.ok||retryCandles.length>=30)result={...retry,resolution_source:"instrument_search",original_key:key};
   }
 }
 return result;
}
export async function getTechnicalForIsin(isin,days=365){
 const token=process.env.UPSTOX_ANALYTICS_TOKEN;if(!token)throw new Error("UPSTOX_ANALYTICS_TOKEN is missing.");
 const cleanIsin=String(isin||"").trim().toUpperCase();if(!cleanIsin)return{available:false,reason:"Missing ISIN.",status:"MISSING_ISIN"};
 const key=`NSE_EQ|${cleanIsin}`;const to=new Date(),from=new Date(to.getTime()-Math.min(Math.max(Number(days)||365,90),3650)*86400000),toDate=to.toISOString().slice(0,10),fromDate=from.toISOString().slice(0,10);
 const {q,h,source,key:resolvedKey,resolution_source,original_key}=await getMarketData(key,toDate,fromDate,token);
 const qt=quote(q.body,resolvedKey),candles=h.body?.data?.candles||[],closes=candles.map(x=>n(x?.[4])).filter(x=>x!=null),highs=candles.map(x=>n(x?.[2])).filter(x=>x!=null),lows=candles.map(x=>n(x?.[3])).filter(x=>x!=null),volumes=candles.map(x=>n(x?.[5])).filter(x=>x!=null),price=qt.price??closes.at(-1)??null;
 if(!q.ok&&!h.ok)return{available:false,reason:`Upstox market data unavailable (quote ${q.status}, history ${h.status}).`,status:"UPSTOX_UNAVAILABLE",price,quote_status:q.status,historical_status:h.status,candles:closes.length,source,instrument_key:resolvedKey,resolution_source,original_instrument_key:original_key};
 if(!price)return{available:false,reason:"No current or historical price returned by Upstox.",status:"PRICE_UNAVAILABLE",price:null,quote_status:q.status,historical_status:h.status,candles:closes.length,source,instrument_key:resolvedKey,resolution_source,original_instrument_key:original_key};
 if(closes.length<30)return{available:false,reason:"Insufficient daily candle history for technical scoring.",status:"INSUFFICIENT_HISTORY",price,previous_close:qt.previous_close,quote_status:q.status,historical_status:h.status,candles:closes.length,source,instrument_key:resolvedKey,resolution_source,original_instrument_key:original_key};
 const s20=sma(closes,20),s50=sma(closes,50),s200=sma(closes,200),r=rsi(closes),e12=ema(closes,12),e26=ema(closes,26);let macd=null,signal=null;
 if(e12.length&&e26.length){macd=e12.at(-1)-e26.at(-1);const ms=[];const off=26-12;for(let i=0;i<e26.length;i++)ms.push(e12[i+off]-e26[i]);const ss=ema(ms,9);signal=ss.at(-1)??null;}
 const hist=macd!=null&&signal!=null?macd-signal:null,atr14=atr(candles),avgVol=sma(volumes,20),volumeRatio=avgVol&&volumes.at(-1)?volumes.at(-1)/avgVol:null,one=ret(closes,21),three=ret(closes,63),six=ret(closes,126),year=ret(closes,252);
 const dr=[];for(let i=Math.max(1,closes.length-21);i<closes.length;i++)if(closes[i-1])dr.push((closes[i]-closes[i-1])/closes[i-1]);const mean=avg(dr)||0,variance=avg(dr.map(x=>(x-mean)**2))||0,vol=Math.sqrt(variance)*Math.sqrt(252)*100;
 let trend="SIDEWAYS";if(s20&&s50&&s200){if(price>s20&&s20>s50&&s50>s200)trend="STRONG_UPTREND";else if(price>s50&&s50>s200)trend="UPTREND";else if(price<s20&&s20<s50&&s50<s200)trend="STRONG_DOWNTREND";else if(price<s50&&s50<s200)trend="DOWNTREND";}
 let score=50;if(s20)score+=price>s20?8:-6;if(s50)score+=price>s50?8:-7;if(s200)score+=price>s200?10:-10;if(r!=null)score+=r>=55&&r<=70?10:r>70?-2:r<40?-8:0;if(hist!=null)score+=hist>0?8:-8;if(three!=null)score+=three>0?6:-6;if(year!=null)score+=year>0?5:-5;
 score=Math.max(0,Math.min(100,score));const recent20High=Math.max(...highs.slice(-20)),recent20Low=Math.min(...lows.slice(-20)),recent50High=Math.max(...highs.slice(-50)),recent50Low=Math.min(...lows.slice(-50)),weekHigh=Math.max(...highs.slice(-252)),weekLow=Math.min(...lows.slice(-252)),bull=["STRONG_UPTREND","UPTREND"].includes(trend),entryLow=bull&&s20?s20*.98:recent20Low,entryHigh=bull&&s20?s20*1.02:(s50||recent20High),stop=bull?Math.min(recent20Low,s50||recent20Low)*.97:Math.min(recent20Low*.97,price*.93),target1=Math.max(recent20High,recent50High,price*1.08),target2=Math.max(weekHigh,price*1.15),risk=Math.max(price-stop,.01);
 return{available:true,price,previous_close:qt.previous_close,change:qt.previous_close!=null?price-qt.previous_close:null,change_pct:qt.previous_close?((price-qt.previous_close)/qt.previous_close)*100:null,volume:qt.volume??volumes.at(-1)??null,trend,technical_score:Number(score.toFixed(1)),moving_averages:{sma20:s20,sma50:s50,sma200:s200},momentum:{rsi14:r,macd,macd_signal:signal,macd_histogram:hist,one_month:one,three_month:three,six_month:six,one_year:year},volatility:{atr14,atr_pct:atr14&&price?(atr14/price)*100:null,annualized_20d_pct:vol,volume_ratio_20d:volumeRatio},levels:{week_52_high:weekHigh,week_52_low:weekLow,recent_20d_high:recent20High,recent_20d_low:recent20Low,recent_50d_high:recent50High,recent_50d_low:recent50Low},trade_plan:{entry_zone:{low:Math.max(0,entryLow),high:Math.max(0,entryHigh)},stop_loss:Math.max(0,stop),target_1:target1,target_2:target2,risk_reward_to_target_1:Number(((target1-price)/risk).toFixed(2)),note:bull?"Trend-following pullback zone; wait for price to hold the zone.":"Not a clean trend-following setup; treat levels as reference, not an automatic buy signal."},data_points:candles.length,last_candle:candles.at(-1)?.[0]||null,quote_status:q.status,historical_status:h.status,data_source:source,instrument_key:resolvedKey,resolution_source,original_instrument_key:original_key};
}
