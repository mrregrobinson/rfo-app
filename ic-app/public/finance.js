// Portfolio reference data and the core liquidity/allocation math (activityImpact,
// getEffectivePort) used by both the app's checklist logic (A2-A5) and its Report
// generation. Loaded as a plain <script> tag by the browser (declares top-level
// `const` bindings visible to the inline script that follows it) and also
// require()-able from Node for the test suite in server/finance.test.js — hence the
// module.exports guard at the bottom, which only runs under Node.

const PORT={asOf:'05-31-2026',totalCAD:31619912,alloc:{'Cash':8.8,'Fixed Income':16.7,'Public Equity':27.9,'Private Credit':17.0,'Diversifying Strategies':5.5,'Real Assets':9.9,'Private Equity':14.2,'Monetary Hedge':0},ips:{'Cash':{min:0,target:3,max:54},'Fixed Income':{min:0,target:3,max:13},'Public Equity':{min:13,target:23,max:33},'Private Credit':{min:18,target:28,max:38},'Diversifying Strategies':{min:0,target:8,max:18},'Real Assets':{min:5,target:15,max:25},'Private Equity':{min:10,target:20,max:30},'Monetary Hedge':{min:0,target:3,max:5}},unfunded:[{fund:'Fortress Private Lending',class:'Private Credit',unfundedCAD:172185,call12m:false},{fund:'CarVal Clean Energy Fund II',class:'Private Credit',unfundedCAD:86079,call12m:true},{fund:'iCap Millennium International',class:'Diversifying Strategies',unfundedCAD:251223,call12m:false},{fund:'Blackstone SP Infrastructure IV',class:'Real Assets',unfundedCAD:705236,call12m:false},{fund:'Dalfen Last Mile Industrial V',class:'Real Assets',unfundedCAD:156389,call12m:true},{fund:'PQ SPVR 2022 LP',class:'Real Assets',unfundedCAD:234383,call12m:false},{fund:'Blue Owl GP Stakes VI',class:'Private Equity',unfundedCAD:1239722,call12m:false},{fund:'Genstar Capital Partners XI',class:'Private Equity',unfundedCAD:1158797,call12m:false},{fund:'Khosla Ventures Opp. II',class:'Private Equity',unfundedCAD:61905,call12m:false},{fund:'Khosla Ventures VIII',class:'Private Equity',unfundedCAD:151497,call12m:false},{fund:'Velocity Fund II',class:'Private Equity',unfundedCAD:340915,call12m:false},{fund:'Vista Equity Partners VIII-A',class:'Private Equity',unfundedCAD:240118,call12m:false}],fx:{'CAD':{pct:48.3,val:15272418},'USD':{pct:51.7,val:16347494},'EUR':{pct:0,val:0},'GBP':{pct:0,val:0}},feeNorms:{'Private Equity':'1.5–2.0% mgmt / 20% carry / 8% hurdle','Private Credit':'1.0–1.5% mgmt / 15–20% carry / 6–8% hurdle','Real Assets':'1.25–1.75% mgmt / 20% carry / 8% hurdle','Diversifying Strategies':'1.0–2.0% mgmt / 10–20% carry / varies','Public Equity':'0.5–1.0% mgmt / varies','Fixed Income':'0.3–0.75% mgmt','Cash':'<0.3% mgmt','Monetary Hedge':'varies'}};
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

if(typeof module!=='undefined'){
  module.exports={PORT,ACTIVITY_TIMINGS,NEAR_TERM_TIMINGS,ACTIVITY_FX,activityImpact,getEffectivePort};
}
