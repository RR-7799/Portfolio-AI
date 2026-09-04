const UPSTOX_BASE = "https://api.upstox.com/v3";

const num = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
const avg = (xs) => { const a = xs.filter(Number.isFinite); return a.length ? a.reduce((s,v)=>s+v,0)/a.length : null; };
const sma = (xs,n) => xs.length >= n ? avg(xs.slice(-n)) : null;

function returns(closes, n) {
  if (closes.length <= n) return null;
  const old = closes[closes.length - 1 - n];
  const last = closes.at(-1);
  return old ? ((last-old)/old)*100 : null;
}

function rsi(closes, period=14) {
  if (closes.length <= period) return null;
  let gain=0, loss=0;
  for(let i=1;i<=period;i++) { const d=closes[i]-closes[i-1]; if(d>=0) gain+=d; else loss-=d; }
  let ag=gain/period, al=loss/period;
  for(let i=period+1;i<closes.length;i++) {
    const d=closes[i]-closes[i-1];
    ag=((ag*(period-1))+Math.max(d,0))/period;
    al=((al*(period-1))+Math.max(-d,0))/period;
  }
  if(al===0) return 100;
  return 100-(100/(1+ag/al));
}

async function fetchUpstox(path, token) {
  const response = await fetch(`${UPSTOX_BASE}${path}`, {
    headers: { Accept:"application/json", Authorization:`Bearer ${token}` },
    cache:"no-store",
  });
  const text = await response.text();
  let body={};
  try { body=JSON.parse(text); } catch { body={raw_text:text}; }
  return { ok:response.ok, status:response.status, body };
}

export async function getMarketTechnical(isin, days=365) {
  const token=process.env.UPSTOX_ANALYTICS_TOKEN;
  if(!token) throw new Error("UPSTOX_ANALYTICS_TOKEN is missing.");
  const clean=String(isin||"").trim().toUpperCase();
  if(!clean) return {available:false,reason:"Missing ISIN."};
  const periodDays=Math.min(Math.max(Number(days)||365,90),3650);
  const key=`NSE_EQ|${clean}`;
  const to=new Date();
  const from=new Date(to.getTime()-periodDays*86400000);
  const toDate=to.toISOString().slice(0,10), fromDate=from.toISOString().slice(0,10);
  const [quoteRes,historyRes]=await Promise.all([
    fetchUpstox(`/market-quote/ltp?instrument_key=${encodeURIComponent(key)}`,token),
    fetchUpstox(`/historical-candle/${encodeURIComponent(key)}/days/1/${toDate}/${fromDate}`,token),
  ]);
  const root=quoteRes.body?.data||{};
  const q=root[key]||Object.values(root)[0]||{};
  const price=num(q?.last_price??q?.ltp??q?.last_traded_price);
  const previousClose=num(q?.cp??q?.previous_close);
  const candles=historyRes.body?.data?.candles||[];
  const closes=candles.map(x=>num(x?.[4])).filter(v=>v!==null);
  const volumes=candles.map(x=>num(x?.[5])).filter(v=>v!==null);
  const highs=candles.map(x=>num(x?.[2])).filter(v=>v!==null);
  const lows=candles.map(x=>num(x?.[3])).filter(v=>v!==null);
  const effectivePrice=price??closes.at(-1)??null;
  if(!historyRes.ok || closes.length<30) {
    return { available:false, price:effectivePrice, reason:"Insufficient or unavailable historical market data.", quote_status:quoteRes.status, historical_status:historyRes.status, data_points:closes.length };
  }
  const s20=sma(closes,20), s50=sma(closes,50), s200=sma(closes,200);
  const rsi14=rsi(closes,14);
  const oneMonth=returns(closes,21), threeMonth=returns(closes,63), sixMonth=returns(closes,126), oneYear=returns(closes,252);
  const daily=[];
  for(let i=Math.max(1,closes.length-21);i<closes.length;i++) daily.push((closes[i]-closes[i-1])/closes[i-1]);
  const mean=avg(daily)||0, variance=avg(daily.map(x=>(x-mean)**2))||0;
  const volatility=Math.sqrt(variance)*Math.sqrt(252)*100;
  let trend="SIDEWAYS";
  if(s20&&s50&&s200) {
    if(effectivePrice>s20&&s20>s50&&s50>s200) trend="STRONG_UPTREND";
    else if(effectivePrice>s50&&s50>s200) trend="UPTREND";
    else if(effectivePrice<s20&&s20<s50&&s50<s200) trend="STRONG_DOWNTREND";
    else if(effectivePrice<s50&&s50<s200) trend="DOWNTREND";
  }
  const avgVol20=sma(volumes,20), latestVol=volumes.at(-1)??null;
  const volumeRatio=latestVol&&avgVol20?latestVol/avgVol20:null;
  return {
    available:true,
    price:effectivePrice,
    previous_close:previousClose,
    change:previousClose&&effectivePrice?effectivePrice-previousClose:null,
    change_pct:previousClose&&effectivePrice?((effectivePrice-previousClose)/previousClose)*100:null,
    trend,
    moving_averages:{sma20:s20,sma50:s50,sma200:s200},
    momentum:{rsi14,one_month:oneMonth,three_month:threeMonth,six_month:sixMonth,one_year:oneYear},
    volatility:{annualized_20d_pct:volatility,volume_ratio_20d:volumeRatio},
    levels:{week_52_high:Math.max(...highs.slice(-252)),week_52_low:Math.min(...lows.slice(-252)),recent_20d_high:Math.max(...highs.slice(-20)),recent_20d_low:Math.min(...lows.slice(-20)),recent_50d_high:Math.max(...highs.slice(-50)),recent_50d_low:Math.min(...lows.slice(-50))},
    data_points:closes.length,
    quote_status:quoteRes.status,
    historical_status:historyRes.status,
  };
}
