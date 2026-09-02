// Portfolio reference data and the core liquidity/allocation math (activityImpact,
// getEffectivePort) used by both the app's checklist logic (A2-A5) and its Report
// generation. Loaded as a plain <script> tag by the browser (declares top-level
// `const` bindings visible to the inline script that follows it) and also
// require()-able from Node for the test suite in server/finance.test.js — hence the
// module.exports guard at the bottom, which only runs under Node.
//
// PORT is bootstrap defaults ONLY. On load, due-diligence.html fetches the current
// portfolio snapshot from GET /api/portfolio (admin-uploaded from the latest PQ
// investment report — see /api/admin/portfolio/*) and mutates this object's properties
// in place with Object.assign, so every function below keeps working unchanged once real
// data is loaded. ips (IPS bands) and feeNorms (market-norm benchmarks) are deliberately
// NOT part of an uploaded snapshot — they're governance policy / external market data, not
// something a single investment report should be able to overwrite.
//
// unfunded[].commitment below is a placeholder (set equal to the unfunded amount, i.e. an
// assumed 0% called) — no real book-value commitment size was available when this was
// last hand-edited. It's superseded the moment an admin uploads a real snapshot; until
// then, the 10/10/20/remaining capital-call pacing math in computeClaudeAnswers will
// understate near-term calls for any position that's already partly called.
const PORT={asOf:'05-31-2026',totalCAD:31619912,alloc:{'Cash':8.8,'Fixed Income':16.7,'Public Equity':27.9,'Private Credit':17.0,'Diversifying Strategies':5.5,'Real Assets':9.9,'Private Equity':14.2,'Monetary Hedge':0},ips:{'Cash':{min:0,target:3,max:54},'Fixed Income':{min:0,target:3,max:13},'Public Equity':{min:13,target:23,max:33},'Private Credit':{min:18,target:28,max:38},'Diversifying Strategies':{min:0,target:8,max:18},'Real Assets':{min:5,target:15,max:25},'Private Equity':{min:10,target:20,max:30},'Monetary Hedge':{min:0,target:3,max:5}},unfunded:[{fund:'Fortress Private Lending',class:'Private Credit',currency:'CAD',commitment:172185,called:0,unfunded:172185},{fund:'CarVal Clean Energy Fund II',class:'Private Credit',currency:'CAD',commitment:86079,called:0,unfunded:86079},{fund:'iCap Millennium International',class:'Diversifying Strategies',currency:'CAD',commitment:251223,called:0,unfunded:251223},{fund:'Blackstone SP Infrastructure IV',class:'Real Assets',currency:'CAD',commitment:705236,called:0,unfunded:705236},{fund:'Dalfen Last Mile Industrial V',class:'Real Assets',currency:'CAD',commitment:156389,called:0,unfunded:156389},{fund:'PQ SPVR 2022 LP',class:'Real Assets',currency:'CAD',commitment:234383,called:0,unfunded:234383},{fund:'Blue Owl GP Stakes VI',class:'Private Equity',currency:'CAD',commitment:1239722,called:0,unfunded:1239722},{fund:'Genstar Capital Partners XI',class:'Private Equity',currency:'CAD',commitment:1158797,called:0,unfunded:1158797},{fund:'Khosla Ventures Opp. II',class:'Private Equity',currency:'CAD',commitment:61905,called:0,unfunded:61905},{fund:'Khosla Ventures VIII',class:'Private Equity',currency:'CAD',commitment:151497,called:0,unfunded:151497},{fund:'Velocity Fund II',class:'Private Equity',currency:'CAD',commitment:340915,called:0,unfunded:340915},{fund:'Vista Equity Partners VIII-A',class:'Private Equity',currency:'CAD',commitment:240118,called:0,unfunded:240118}],liquidityTiers:[],fx:{'CAD':{pct:48.3,val:15272418},'USD':{pct:51.7,val:16347494},'EUR':{pct:0,val:0},'GBP':{pct:0,val:0}},feeNorms:{'Private Equity':'1.5–2.0% mgmt / 20% carry / 8% hurdle','Private Credit':'1.0–1.5% mgmt / 15–20% carry / 6–8% hurdle','Real Assets':'1.25–1.75% mgmt / 20% carry / 8% hurdle','Diversifying Strategies':'1.0–2.0% mgmt / 10–20% carry / varies','Public Equity':'0.5–1.0% mgmt / varies','Fixed Income':'0.3–0.75% mgmt','Cash':'<0.3% mgmt','Monetary Hedge':'varies'}};
const ACTIVITY_TIMINGS=['0-6 months','6-12 months','12-24 months','24+ months','Uncertain'];
const NEAR_TERM_TIMINGS=['0-6 months','6-12 months','Uncertain'];
const ACTIVITY_FX={CAD:1,USD:1.3775,EUR:1.6075,GBP:1.72};
function activityImpact(activities,opts){
  const nearTermOnly=!!(opts&&opts.nearTermOnly);let totalDelta=0;const classDelta={};
  (activities||[]).forEach(a=>{
    if(a.status==='Completed')return;
    if(nearTermOnly&&!NEAR_TERM_TIMINGS.includes(a.timing))return;
    const amt=a.amount*(ACTIVITY_FX[a.currency]||1);
    if(a.decreaseClass){classDelta[a.decreaseClass]=(classDelta[a.decreaseClass]||0)-amt;}else{totalDelta+=amt;}
    if(a.increaseClass){classDelta[a.increaseClass]=(classDelta[a.increaseClass]||0)+amt;}else{totalDelta-=amt;}
  });
  return {totalDelta,classDelta};
}
function getEffectivePort(activities,opts){
  const impact=activityImpact(activities,opts);const classes=Object.keys(PORT.alloc);
  const baseCAD={};classes.forEach(c=>{baseCAD[c]=(PORT.alloc[c]/100)*PORT.totalCAD;});
  const totalCAD=PORT.totalCAD+impact.totalDelta;
  const allocCAD={};classes.forEach(c=>{allocCAD[c]=baseCAD[c]+(impact.classDelta[c]||0);});
  const alloc={};classes.forEach(c=>{alloc[c]=totalCAD>0?(allocCAD[c]/totalCAD)*100:0;});
  return {totalCAD,allocCAD,alloc};
}

// ---- liquidity ladder (A4) ----
// Family Planning Activities now tag a liquidity category (not an IPS asset class) as
// their source/destination — see LIQUIDITY_CATEGORIES. Known tradeoff: activityImpact()
// above still feeds Section A's asset-class "Allocation Impact" bars (A2), keyed by
// PORT.alloc's asset-class names — an activity tagged with a liquidity category (other
// than the one that happens to also be an asset class, "Cash") no longer moves those
// bars. Its dollar effect is fully captured everywhere in the liquidity ladder below,
// which is the tradeoff the family asked for: liquidity category is now the primary lens
// for these activities.
const LIQUIDITY_BUCKETS=['0-6 months','6-12 months','12-24 months','24+ months'];
const LIQUIDITY_CATEGORIES=['Cash','Highly Liquid','Medium Liquidity','Low Liquidity'];
// Which tiers are unlocked as an available source by the end of each bucket — a cascading
// waterfall, cash first: 0-6mo = cash only; 6-12mo = + highly liquid; 12-24mo = + medium
// liquidity; 24mo+ = + low liquidity. Whatever isn't used in an earlier bucket carries
// forward automatically, since sources/uses below are tracked as running totals.
const BUCKET_UNLOCKED_TIERS={
  '0-6 months':['Cash'],
  '6-12 months':['Cash','Highly Liquid'],
  '12-24 months':['Cash','Highly Liquid','Medium Liquidity'],
  '24+ months':['Cash','Highly Liquid','Medium Liquidity','Low Liquidity'],
};

// Bootstrap default for the "Yield Generating Investments and Projected Income" upload —
// see PORT's own header comment; same pattern, mutated in place once /api/income resolves.
const INCOME={asOf:null,positions:[]};

function tierTotalsCAD(port){
  const totals={};LIQUIDITY_CATEGORIES.forEach(c=>{totals[c]=0;});
  (port.liquidityTiers||[]).forEach(t=>{
    const sum=(t.items||[]).reduce((s,it)=>s+(it.amount||0)*(ACTIVITY_FX[it.currency]||1),0);
    totals[t.tier]=(totals[t.tier]||0)+sum;
  });
  return totals;
}

// 10% of the commitment's book value for each of the first two (6-month) buckets, 20% for
// the third (12-24mo), and whatever's left unfunded for the open-ended 24mo+ bucket —
// capped throughout at what's actually still unfunded (never "need" more than what's left
// to fund). Used both for existing unfunded commitments and for previewing a new one.
function capitalCallSchedule(commitmentCAD,unfundedCAD){
  const c=Math.max(0,commitmentCAD);let remaining=Math.max(0,unfundedCAD);
  const b1=Math.min(c*0.10,remaining);remaining-=b1;
  const b2=Math.min(c*0.10,remaining);remaining-=b2;
  const b3=Math.min(c*0.20,remaining);remaining-=b3;
  return {'0-6 months':b1,'6-12 months':b2,'12-24 months':b3,'24+ months':remaining};
}

function unfundedCallScheduleCAD(port){
  const totals={};LIQUIDITY_BUCKETS.forEach(b=>{totals[b]=0;});
  (port.unfunded||[]).forEach(u=>{
    const fx=ACTIVITY_FX[u.currency]||1;
    const unfundedAmt=u.unfunded!=null?u.unfunded:(u.unfundedCAD||0);
    const sched=capitalCallSchedule((u.commitment||0)*fx,unfundedAmt*fx);
    LIQUIDITY_BUCKETS.forEach(b=>{totals[b]+=sched[b];});
  });
  return totals;
}

// Recurring distributions projected into the same 4 buckets: half a year's worth of
// annual distributions for each of the first two (6-month) buckets, a full year for
// 12-24mo, and a further year as a representative figure for 24mo+ (the stream actually
// continues indefinitely past that — this bucket is not a terminal total). Registered-
// account income is split out rather than counted as available, since withdrawing it
// carries tax/lock-in consequences the family may not want to trigger just to fund a
// capital call.
function incomeByBucketCAD(income){
  const available={};const registered={};
  LIQUIDITY_BUCKETS.forEach(b=>{available[b]=0;registered[b]=0;});
  ((income&&income.positions)||[]).forEach(p=>{
    const annualCAD=(p.annualDistribution||0)*(ACTIVITY_FX[p.currency]||1);
    const perBucket={'0-6 months':annualCAD*0.5,'6-12 months':annualCAD*0.5,'12-24 months':annualCAD,'24+ months':annualCAD};
    const target=p.isRegistered?registered:available;
    LIQUIDITY_BUCKETS.forEach(b=>{target[b]+=perBucket[b];});
  });
  return {available,registered};
}

// The full A4 picture for one opportunity: existing unfunded commitments' capital-call
// pacing, plus (if reviewing a new commitment) that commitment's own pacing, against the
// cascading asset-tier waterfall plus projected income — all as running (cumulative)
// totals per bucket, so a shortfall shows up the moment cumulative uses would exceed
// cumulative sources. newCommitmentCAD is optional (0/undefined = existing book only).
function computeLiquidityPlan(opts){
  const port=(opts&&opts.port)||PORT;const income=(opts&&opts.income)||INCOME;
  const nonCompleted=((opts&&opts.activities)||[]).filter(a=>a.status!=='Completed');
  const newCommitmentCAD=(opts&&opts.newCommitmentCAD)||0;
  const impact=activityImpact(nonCompleted);
  const baseTiers=tierTotalsCAD(port);
  const adjTiers={};LIQUIDITY_CATEGORIES.forEach(c=>{adjTiers[c]=baseTiers[c]+(impact.classDelta[c]||0);});
  const existingCalls=unfundedCallScheduleCAD(port);
  const incomeBuckets=incomeByBucketCAD(income);
  const newCalls=newCommitmentCAD>0?capitalCallSchedule(newCommitmentCAD,newCommitmentCAD):null;

  let unlockedSoFar=[],cumSourcesTier=0,cumIncome=0,cumExistingUses=0,cumNewUses=0;
  const rows=LIQUIDITY_BUCKETS.map(bucket=>{
    const newlyUnlocked=BUCKET_UNLOCKED_TIERS[bucket].filter(t=>!unlockedSoFar.includes(t));
    unlockedSoFar=BUCKET_UNLOCKED_TIERS[bucket];
    const tierSourceThisBucket=newlyUnlocked.reduce((s,t)=>s+Math.max(0,adjTiers[t]||0),0);
    cumSourcesTier+=tierSourceThisBucket;
    cumIncome+=incomeBuckets.available[bucket];
    cumExistingUses+=existingCalls[bucket];
    cumNewUses+=newCalls?newCalls[bucket]:0;
    return {
      bucket,newlyUnlockedTiers:newlyUnlocked,
      tierSourceThisBucket,incomeThisBucket:incomeBuckets.available[bucket],
      existingCallThisBucket:existingCalls[bucket],newCallThisBucket:newCalls?newCalls[bucket]:0,
      cumSources:cumSourcesTier+cumIncome,cumUses:cumExistingUses+cumNewUses,
      netCumulative:(cumSourcesTier+cumIncome)-(cumExistingUses+cumNewUses),
    };
  });
  return {rows,registeredIncome:incomeBuckets.registered,hasLiquidityData:((port.liquidityTiers||[]).length>0)};
}

if(typeof module!=='undefined'){
  module.exports={PORT,INCOME,ACTIVITY_TIMINGS,NEAR_TERM_TIMINGS,ACTIVITY_FX,LIQUIDITY_BUCKETS,LIQUIDITY_CATEGORIES,activityImpact,getEffectivePort,tierTotalsCAD,capitalCallSchedule,unfundedCallScheduleCAD,incomeByBucketCAD,computeLiquidityPlan};
}
