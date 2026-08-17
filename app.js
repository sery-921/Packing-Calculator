"use strict";

const FLUTES={E:[2,.55],B:[2,.65],C:[4,.70],A:[5,.75],AB:[3,.95],BE:[5,1.00],BC:[6,1.05],AAA:[15,1.40]};
const FALLBACK_COMMON=[
  {name:"300×250×200 E楞",dimensions:[300,250,200],dimension_type:"outer",flute:"E"},
  {name:"350×250×250 B楞",dimensions:[350,250,250],dimension_type:"outer",flute:"B"},
  {name:"400×300×300 B楞",dimensions:[400,300,300],dimension_type:"outer",flute:"B"},
  {name:"450×350×350 C楞",dimensions:[450,350,350],dimension_type:"outer",flute:"C"},
  {name:"500×300×400 C楞",dimensions:[500,300,400],dimension_type:"outer",flute:"C"},
  {name:"600×300×300 BC楞",dimensions:[600,300,300],dimension_type:"outer",flute:"BC"},
  {name:"400×400×400 C楞",dimensions:[400,400,400],dimension_type:"outer",flute:"C"},
  {name:"600×400×400 BC楞",dimensions:[600,400,400],dimension_type:"outer",flute:"BC"}
];
const COMMON=Array.isArray(window.COMMON_CARTONS)&&window.COMMON_CARTONS.length?window.COMMON_CARTONS:FALLBACK_COMMON;
const EPE_FACE_MAPS=window.EPE_FOAM_FACE_MAPS||{};
const EPE_SKUS=window.EPE_FOAM_SKUS||{};
let current=null;
let plansExpanded=false;
let exportUrls=[];
let exportGeneration=0;
let preview3dRetryTimer=0;
const $=id=>document.getElementById(id);
const value=id=>{const n=Number($(id).value);if(!Number.isFinite(n)||n<0)throw new Error(`${$(id).closest("label")?.childNodes[0]?.textContent.trim()||id} 需要有效数字`);return n};
const product=a=>a.reduce((x,y)=>x*y,1);
const uniquePermutations=d=>{const out=[];for(const a of d)for(const b of d)for(const c of d)if([a,b,c].sort((x,y)=>x-y).join()===[...d].sort((x,y)=>x-y).join()&&!out.some(v=>v.join()===[a,b,c].join()))out.push([a,b,c]);return out};
const planKey=item=>`${item.carton.sku||""}|${item.carton.code||""}|${item.carton.name}|${item.layout.mode||"uniformOrientation"}|${item.layout.counts.join("x")}|${item.layout.orientation.join("x")}|${item.layout.orientationDistribution?`${item.layout.orientationDistribution.rotation0}-${item.layout.orientationDistribution.rotation90}`:""}`;
const DOUBLE_WALL_CARTON_RULE={wall:6,axisOffsets:[12,12,24]};
const BE_DOUBLE_WALL_CARTON_RULE={wall:5,axisOffsets:[10,10,20]};
const K6K_CARTON_RULE={wall:3,axisOffsets:[6,6,12]};
const K3K_CARTON_RULE={wall:2,axisOffsets:[4,4,8]};
const FOAM_MIN_COMPRESSED_MM=7;
const FOAM_FRIENDLY_MAX_STEP_RATIO=2;
const FOAM_CLOSURE_BONUS=600000;
const PADDING_AXES=["length","width","height"];

function boardRule(raw,flute){
  const material=String(raw.material||raw.name||"").toUpperCase();
  const fluteName=String(flute||"").toUpperCase();
  if(material.includes("K3KE")||material.includes("K3K"))return K3K_CARTON_RULE;
  if(material.includes("K6K"))return K6K_CARTON_RULE;
  if(material.includes("BE")||fluteName==="BE")return BE_DOUBLE_WALL_CARTON_RULE;
  if(material.includes("K=K")||material.includes("BC坑")||fluteName==="BC")return DOUBLE_WALL_CARTON_RULE;
  return null;
}

function carton(raw){
  const flute=raw.flute||"BC",profile=FLUTES[flute]||[raw.wall_thickness_mm||0,raw.board_mass_kg_m2||.70];
  const rule=boardRule(raw,flute);
  const wall=Number(rule?.wall??raw.wall_thickness_mm??raw.wall??profile[0]),mass=Number(raw.board_mass_kg_m2??profile[1]??.70);
  const axisOffsets=rule?.axisOffsets??[2*wall,2*wall,2*wall];
  const dims=raw.dims||raw.dimensions,kind=raw.kind||raw.dimension_type||"outer";
  const outer=kind==="outer"?dims:dims.map((v,i)=>v+axisOffsets[i]);
  const inner=kind==="outer"?dims.map((v,i)=>v-axisOffsets[i]):dims;
  if(Math.min(...inner)<=0)throw new Error("扣除纸板厚度后，外箱没有有效内尺寸");
  const [l,w,h]=outer.map(v=>v/1000);
  return{...raw,name:raw.name,inner,outer,wall,axisOffsets,flute,weight:2*(l*w+l*h+w*h)*mass*1.1};
}
function pad(margin,t,enabled){
  if(!enabled||margin<FOAM_MIN_COMPRESSED_MM)return{margin,sheets:0,low:0,high:0,unfilled:margin,compression:0,lowStack:0,highStack:0};
  let sheets=Math.floor((margin+1e-9)/t);
  const remainder=margin-sheets*t;
  if(sheets===0)sheets=1;
  else if(remainder+1e-9>=FOAM_MIN_COMPRESSED_MM)sheets+=1;
  let low=Math.floor(sheets/2),high=sheets-low;
  if(margin/2>=FOAM_MIN_COMPRESSED_MM&&low===0&&high>0){low=1;sheets=low+high}
  const occupied=sheets*t>margin?margin/sheets:t;
  const lowStack=low*occupied,highStack=high*occupied;
  return{margin,sheets,low,high,unfilled:Math.max(0,margin-lowStack-highStack),compression:Math.max(0,sheets*t-margin),lowStack,highStack};
}
function axisCount(space,part,clearance,allowFullFit){
  const strict=Math.floor((space-clearance+1e-9)/part);
  if(!allowFullFit)return strict;
  const physical=Math.floor((space+1e-9)/part);
  return Math.max(strict,physical);
}
function uniformBoxes(layout){
  const [dx,dy,dz]=layout.orientation,[nx,ny,nz]=layout.counts,boxes=[];
  for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)boxes.push({index:boxes.length,x:i*dx,y:j*dy,z:k*dz,length:dx,width:dy,height:dz,rotation:layout.rotation||0});
  return boxes;
}
function placedBoxesForLayout(layout){
  return Array.isArray(layout.boxes)&&layout.boxes.length?layout.boxes:uniformBoxes(layout);
}
function applyEvaluation(c,box,opt,layout){
  if(window.PackingEvaluator)layout.evaluation=window.PackingEvaluator.evaluateLayout(layout,c,box,opt);
  return layout;
}
function finishLayout(c,box,opt,item){
  const padding={length:pad(item.residual[0],opt.foamT,opt.foam),width:pad(item.residual[1],opt.foamT,opt.foam),height:pad(item.residual[2],opt.foamT,opt.foam)};
  const foamTotal=Object.values(padding).reduce((s,p)=>s+p.sheets,0);
  const pkgCost=opt.cartonCost+foamTotal*opt.foamCost+opt.handlingCost;
  return{...item,padding,foamTotal,utilization:item.quantity*product(box.dims)/product(c.inner),totalWeight:item.quantity*box.weight+c.weight,cost:{packagingCost:pkgCost,costPerBox:item.quantity?pkgCost/item.quantity:0}};
}
function hasFoamPair(p){return !!p&&p.low>0&&p.high>0}
function hasSixFaceFoam(l){return PADDING_AXES.every(axis=>hasFoamPair(l.padding?.[axis]))}
function layoutScore(item,opt){return(item.evaluation?.sortScore??(item.quantity*100000+item.utilization*1000))+(opt?.sixFaceFoamRequired&&hasSixFaceFoam(item)?FOAM_CLOSURE_BONUS:0)}
function isBetterLayout(candidate,best,opt){
  if(!best)return true;
  if(opt?.sixFaceFoamRequired){
    const candidateHasFoam=hasSixFaceFoam(candidate),bestHasFoam=hasSixFaceFoam(best);
    if(candidateHasFoam!==bestHasFoam)return candidateHasFoam;
  }
  const residualSum=candidate.residual.reduce((a,b)=>a+b,0),bestResidual=best.residual.reduce((a,b)=>a+b,0);
  const itemScore=layoutScore(candidate,opt),bestScore=layoutScore(best,opt);
  return itemScore>bestScore||(Math.abs(itemScore-bestScore)<1e-9&&residualSum<bestResidual);
}
function buildUniformLayout(c,box,opt,o,counts,rotation,meta={}){
  const quantity=product(counts);if(quantity<=0)return null;
  const residual=c.inner.map((v,i)=>Math.max(0,+(v-counts[i]*o[i]).toFixed(6)));
  const item=finishLayout(c,box,opt,{mode:"uniformOrientation",orientation:o,counts,quantity,residual,areaUtilization:(counts[0]*counts[1]*o[0]*o[1])/(c.inner[0]*c.inner[1]),orientationDistribution:{rotation0:rotation===0?quantity:0,rotation90:rotation===90?quantity:0},boxes:null,rotation,...meta});
  item.boxes=uniformBoxes(item);
  return applyEvaluation(c,box,opt,item);
}
function foamFriendlyCounts(item,opt){
  if(!opt.foam)return null;
  const counts=item.counts.slice();
  let changed=false;
  for(let i=0;i<3;i++){
    const axis=PADDING_AXES[i],current=item.padding?.[axis],step=Number(item.orientation?.[i])||0;
    if(hasFoamPair(current)||counts[i]<=1||step<=0||step>opt.foamT*FOAM_FRIENDLY_MAX_STEP_RATIO+1e-9)continue;
    const target=FOAM_MIN_COMPRESSED_MM*2,drop=Math.ceil((target-(Number(item.residual?.[i])||0)-1e-9)/step);
    if(drop!==1||counts[i]-drop<1)continue;
    counts[i]-=drop;changed=true;
  }
  return changed?counts:null;
}
function foamFriendlyUniformVariant(c,box,opt,item){
  const counts=foamFriendlyCounts(item,opt);
  if(!counts)return null;
  const variant=buildUniformLayout(c,box,opt,item.orientation,counts,item.rotation,{foamAdjustment:"thin-axis-derated"});
  return variant&&hasSixFaceFoam(variant)?variant:null;
}
function layoutForUniform(c,box,opt){
  const orientations=opt.upright?[[box.dims[0],box.dims[1],box.dims[2]],[box.dims[1],box.dims[0],box.dims[2]]]:uniquePermutations(box.dims);
  let best=null;
  for(const o of orientations){
    const counts=c.inner.map((v,i)=>axisCount(v,o[i],opt.clearance,opt.allowFullFit));
    if(product(counts)<=0)continue;
    const rotation=o[0]===box.dims[0]&&o[1]===box.dims[1]?0:90;
    const item=buildUniformLayout(c,box,opt,o,counts,rotation);
    for(const candidate of [item,foamFriendlyUniformVariant(c,box,opt,item)].filter(Boolean)){
      if(isBetterLayout(candidate,best,opt))best=candidate;
    }
  }
  return opt.sixFaceFoamRequired&&best&&!hasSixFaceFoam(best)?null:best;
}
function layoutForMixed(c,box,opt,uniform){
  if(!window.PackingMixed)throw new Error("混排算法模块未加载");
  if(!opt.upright)return uniform;
  const mixed=window.PackingMixed.packMixedFlat({cartonInner:c.inner,boxDims:box.dims,clearance:opt.clearance,allowFullFit:opt.allowFullFit});
  if(!mixed.feasible)return null;
  const residual=[mixed.remaining.lengthResidual,mixed.remaining.widthResidual,mixed.remaining.heightResidual].map(v=>Math.max(0,+v.toFixed(6)));
  const layout=finishLayout(c,box,opt,{mode:"mixedOrientationFlat",method:mixed.method,orientation:[box.dims[0],box.dims[1],box.dims[2]],counts:[mixed.countPerLayer,1,mixed.layers],quantity:mixed.count,residual,areaUtilization:mixed.areaUtilization,orientationDistribution:mixed.orientationDistribution,boxes:mixed.boxes,freeRectangles:mixed.freeRectangles,warnings:mixed.warnings||[],uniformQuantity:uniform?.quantity||0,improvement:mixed.count-(uniform?.quantity||0)});
  return applyEvaluation(c,box,opt,layout);
}
function layoutFor(c,box,opt){
  const uniform=layoutForUniform(c,box,opt);
  if(opt.mode!=="mixedOrientationFlat")return uniform;
  const mixed=layoutForMixed(c,box,opt,uniform);
  if(opt.sixFaceFoamRequired){
    const mixedHasFoam=!!mixed&&hasSixFaceFoam(mixed),uniformHasFoam=!!uniform&&hasSixFaceFoam(uniform);
    if(mixedHasFoam!==uniformHasFoam)return mixedHasFoam?mixed:uniform;
    if(!mixedHasFoam&&!uniformHasFoam)return null;
  }
  if(!mixed)return uniform;
  if(!uniform)return mixed;
  const mixedScore=layoutScore(mixed,opt);
  const uniformScore=layoutScore(uniform,opt);
  return mixedScore>uniformScore?mixed:uniform;
}
function collect(){
  const box={dims:[value("innerL"),value("innerW"),value("innerH")],weight:value("innerWeight")};
  if(Math.min(...box.dims)<=0)throw new Error("内盒尺寸必须大于0");
  const autoMode=$("autoMode").checked;
  const sixFaceFoamRequired=$("sixFaceFoamRequired")?.checked??false;
  const opt={mode:$("mixedOrientationFlat")?.checked?"mixedOrientationFlat":"uniformOrientation",upright:$("upright").checked,foam:$("foamEnabled").checked||sixFaceFoamRequired,sixFaceFoamRequired,strict:$("strictErgonomics").checked,allowFullFit:$("allowFullFit")?.checked??true,foamPreference:$("foamPreference")?.value||"all",clearance:value("clearance"),foamT:value("foamThickness"),maxWeight:value("maxWeight"),cartonCost:value("cartonCost"),foamCost:value("foamCost"),handlingCost:value("handlingCost")};
  if(opt.foamT<=0)throw new Error("珍珠棉厚度必须大于0");
  let candidates;
  if(autoMode)candidates=COMMON.map(raw=>carton(raw));
  else{
    const kind=document.querySelector('input[name="dimensionType"]:checked').value;
    candidates=[carton({name:"指定箱型",dims:[value("cartonL"),value("cartonW"),value("cartonH")],flute:$("flute").value,kind})];
  }
  let evaluated=candidates.map(c=>({carton:c,layout:layoutFor(c,box,opt)})).filter(x=>x.layout).map(x=>({...x,ergonomics:{passed:x.carton.outer.reduce((a,b)=>a+b,0)<=1200&&Math.max(...x.carton.outer)<=800&&x.layout.totalWeight<=opt.maxWeight,dimSum:x.carton.outer.reduce((a,b)=>a+b,0),longEdge:Math.max(...x.carton.outer)}}));
  if(autoMode&&opt.strict)evaluated=evaluated.filter(x=>x.ergonomics.passed);
  if(autoMode&&opt.foamPreference==="paired")evaluated=evaluated.filter(x=>x.carton.has_existing_foam);
  if(autoMode&&opt.foamPreference==="unpaired")evaluated=evaluated.filter(x=>!x.carton.has_existing_foam);
  if(!evaluated.length)throw new Error(autoMode?"没有符合当前珍珠棉偏好的箱型满足装入要求":"没有箱型满足装入要求");
  const hasCost=opt.cartonCost>0||opt.foamCost>0||opt.handlingCost>0;
  const foamTie=(a,b)=>Number(!!b.carton.has_existing_foam)-Number(!!a.carton.has_existing_foam);
  const residualScore=x=>x.layout.residual.reduce((a,b)=>a+b,0)+(x.layout.freeRectangles?.length||0)*20;
  const score=x=>(x.layout.evaluation?.sortScore??(x.layout.quantity*100000+x.layout.utilization*1000+(x.layout.areaUtilization||0)*500-residualScore(x)))+(opt.sixFaceFoamRequired&&hasSixFaceFoam(x.layout)?FOAM_CLOSURE_BONUS:0);
  evaluated.sort((a,b)=>hasCost
    ?(score(b)-score(a))||(a.layout.cost.costPerBox-b.layout.cost.costPerBox)||foamTie(a,b)||product(a.carton.inner)-product(b.carton.inner)
    :(score(b)-score(a))||foamTie(a,b)||product(a.carton.inner)-product(b.carton.inner));
  const _maxQty=evaluated.length?evaluated[0].layout.quantity:0;
  const _planLimit=_maxQty<=3?evaluated.length:12;
  return{box,opt,best:evaluated[0],alternatives:evaluated.slice(1,4),comparisonPlans:evaluated.slice(0,_planLimit),mode:autoMode?"auto-carton-selection":"fixed-carton"};
}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function innerBoxGuideSvg(){
  const dims=["innerL","innerW","innerH"].map(id=>Math.max(value(id)||1,1));
  const max=Math.max(...dims),l=132*dims[0]/max,w=76*dims[1]/max,h=98*dims[2]/max;
  const L=Math.max(72,l),W=Math.max(44,w),H=Math.max(54,h),x=54,y=134,dx=W*.48,dy=-W*.28;
  const p={
    a:[x,y],b:[x+L,y],c:[x+L+dx,y+dy],d:[x+dx,y+dy],
    e:[x,y-H],f:[x+L,y-H],g:[x+L+dx,y+dy-H],h:[x+dx,y+dy-H]
  };
  const pt=q=>`${q[0].toFixed(1)},${q[1].toFixed(1)}`;
  const poly=(arr,fill)=>`<polygon points="${arr.map(q=>pt(p[q])).join(" ")}" fill="${fill}" stroke="#17324d" stroke-width="1.8"/>`;
  const guide="#6f7f8c",ink="#10283e";
  const dim=(x1,y1,x2,y2,label,lx,ly,anchor="middle")=>`
    <line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${guide}" stroke-width="1.6" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
    <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" fill="${ink}" font-size="14" font-weight="500">${label}</text>`;
  const ext=(x1,y1,x2,y2)=>`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#a8b4bd" stroke-width="1" stroke-dasharray="3 3"/>`;
  const lenY=y+17,wOffX=15,wOffY=13,hX=p.c[0]+16;
  const wb=[p.b[0]+wOffX,p.b[1]+wOffY],wc=[p.c[0]+wOffX,p.c[1]+wOffY];
  return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 190" role="img" aria-label="长宽高示意图">
    <defs><marker id="arrow" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 Z" fill="${guide}"/></marker></defs>
    <rect width="300" height="190" rx="14" fill="#f6f8f9"/>
    ${poly(["a","b","f","e"],"#f2c29f")}${poly(["b","c","g","f"],"#e2aa7c")}${poly(["e","f","g","h"],"#f6d2b5")}${poly(["a","d","c","b"],"rgba(242,194,159,.45)")}${poly(["d","h","g","c"],"rgba(226,170,124,.5)")}
    ${ext(p.a[0],p.a[1],p.a[0],lenY)}${ext(p.b[0],p.b[1],p.b[0],lenY)}
    ${dim(p.a[0],lenY,p.b[0],lenY,"长 l",x+L/2,lenY+18)}
    ${ext(p.b[0],p.b[1],wb[0],wb[1])}${ext(p.c[0],p.c[1],wc[0],wc[1])}
    ${dim(wb[0],wb[1],wc[0],wc[1],"宽 w",(wb[0]+wc[0])/2+8,(wb[1]+wc[1])/2+18)}
    ${ext(p.c[0],p.c[1],hX,p.c[1])}${ext(p.g[0],p.g[1],hX,p.g[1])}
    ${dim(hX,p.c[1],hX,p.g[1],"高 h",hX+9,(p.c[1]+p.g[1])/2+5,"start")}
    <text x="18" y="28" fill="#50677a" font-size="13" font-weight="700">销售内盒尺寸方向</text>
  </svg>`;
}
function renderInnerBoxGuide(){
  try{$("innerBoxGuide").innerHTML=innerBoxGuideSvg()}catch(_){}
}
function svgPreviewLegacy(data){
  const {carton:c,layout:l}=data.best,[il,iw,ih]=c.inner,max=Math.max(il,iw,ih),s=390/max,origin=[465,610],lift=ih*.72;
  const p=(x,y,z)=>[origin[0]+(x-y)*s*.66,origin[1]+(x+y)*s*.30-z*s*.76];
  const pts=vs=>vs.map(v=>p(...v).map(n=>n.toFixed(1)).join(",")).join(" ");
  const prism=(x,y,z,dx,dy,dz,fill,opacity=.7,stroke="#17365d",strokeWidth=1.2,strokeOpacity=1)=>{
    if(Math.min(dx,dy,dz)<=0)return "";
    const edge=`stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"`;
    const top=`<polygon points="${pts([[x,y,z+dz],[x+dx,y,z+dz],[x+dx,y+dy,z+dz],[x,y+dy,z+dz]])}" fill="${fill}" fill-opacity="${Math.min(opacity+.16,1)}" ${edge}/>`;
    const left=`<polygon points="${pts([[x,y,z],[x,y+dy,z],[x,y+dy,z+dz],[x,y,z+dz]])}" fill="${fill}" fill-opacity="${opacity*.72}" ${edge}/>`;
    const front=`<polygon points="${pts([[x,y,z],[x+dx,y,z],[x+dx,y,z+dz],[x,y,z+dz]])}" fill="${fill}" fill-opacity="${opacity}" ${edge}/>`;
    const right=`<polygon points="${pts([[x+dx,y,z],[x+dx,y+dy,z],[x+dx,y+dy,z+dz],[x+dx,y,z+dz]])}" fill="${fill}" fill-opacity="${opacity*.62}" ${edge}/>`;
    return left+right+front+top;
  };
  const pad=l.padding,start=[pad.length.lowStack+pad.length.unfilled/2,pad.width.lowStack+pad.width.unfilled/2,pad.height.lowStack+pad.height.unfilled/2+lift];
  const [dx,dy,dz]=l.orientation,[nx,ny,nz]=l.counts,boxes=[];for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)boxes.push([i,j,k]);boxes.sort((a,b)=>a.reduce((x,y)=>x+y)-b.reduce((x,y)=>x+y));
  let body="",labels="";const wall=Math.max(2,Math.min(il,iw)*.025),wallH=ih*.34;
  body+=prism(0,0,0,il,iw,wall,"url(#cartonWall)",.62,"#8c6d46",1.2,.8);
  body+=prism(0,0,0,wall,iw,wallH,"url(#cartonWall)",.7,"#8c6d46",1.2,.8);
  body+=prism(il-wall,0,0,wall,iw,wallH,"url(#cartonWall)",.6,"#8c6d46",1.2,.8);
  body+=prism(wall,0,0,il-2*wall,wall,wallH,"url(#cartonWall)",.7,"#8c6d46",1.2,.8);
  body+=prism(wall,iw-wall,0,il-2*wall,wall,wallH,"url(#cartonWall)",.55,"#8c6d46",1.2,.8);
  const rim=[p(0,0,wallH),p(il,0,wallH),p(il,iw,wallH),p(0,iw,wallH)];
  const flap=(a,b,ox,oy)=>`<polygon points="${a[0]},${a[1]} ${b[0]},${b[1]} ${b[0]+ox},${b[1]+oy} ${a[0]+ox},${a[1]+oy}" fill="url(#cartonWall)" fill-opacity=".72" stroke="#8c6d46" stroke-width="1.3"/>`;
  body+=flap(rim[0],rim[1],0,62)+flap(rim[2],rim[3],0,-62)+flap(rim[1],rim[2],72,12)+flap(rim[3],rim[0],-72,12);
  body+=`<g stroke="#58718a" stroke-width="1.2" stroke-dasharray="6 6" opacity=".75"><line x1="${p(0,0,wallH)[0]}" y1="${p(0,0,wallH)[1]}" x2="${p(0,0,lift)[0]}" y2="${p(0,0,lift)[1]}"/><line x1="${p(il,iw,wallH)[0]}" y1="${p(il,iw,wallH)[1]}" x2="${p(il,iw,lift)[0]}" y2="${p(il,iw,lift)[1]}"/></g>`;
  const boxFills=["url(#boxAmberA)","url(#boxAmberB)","url(#boxAmberC)","url(#boxAmberD)"];
  for(const [i,j,k] of boxes){const x=start[0]+i*dx,y=start[1]+j*dy,z=start[2]+k*dz;body+=prism(x,y,z,dx,dy,dz,boxFills[k%boxFills.length],.86,"#17365d",1.05,.9)}
  const map=c.has_existing_foam?foamFaceMap(c):null;
  if(map&&map.axes){
    const spec=axis=>{const r=map.axes[axis]||{},dims=Array.isArray(r.dimensions_mm)?r.dimensions_mm.join("×"):"-";return{sku:r.sku||"-",dims}};
    const lr=spec("length"),fb=spec("width"),tb=spec("height"),t=8,gap=Math.max(il,iw)*.18,z0=lift,zH=nz*dz;
    body+=prism(-gap-t,0,z0,t,iw,zH,"url(#foamFill)",.72,"#2c766d",1.2,.9)+prism(il+gap,0,z0,t,iw,zH,"url(#foamFill)",.72,"#2c766d",1.2,.9);
    body+=prism(0,-gap-t,z0,il,t,zH,"url(#foamFill)",.68,"#2c766d",1.2,.9)+prism(0,iw+gap,z0,il,t,zH,"url(#foamFill)",.68,"#2c766d",1.2,.9);
    body+=prism(0,0,z0-gap-t,il,iw,t,"url(#foamFill)",.72,"#2c766d",1.2,.9)+prism(0,0,z0+zH+gap,il,iw,t,"url(#foamFill)",.72,"#2c766d",1.2,.9);
    labels=`<g font-family="Microsoft YaHei,Arial" font-size="12" fill="#175f57" font-weight="700"><text x="24" y="300">左/右 ${esc(lr.sku)} · ${esc(lr.dims)} mm · 各1片</text><text x="580" y="330">前/后 ${esc(fb.sku)} · ${esc(fb.dims)} mm · 各1片</text><text x="330" y="92">上/下 ${esc(tb.sku)} · ${esc(tb.dims)} mm · 各1片</text></g>`;
  }
  const title=esc(c.name),foamLegend=map?"配套珍珠棉：左/右、前/后、上/下各1片，共6片":"无配套珍珠棉：仅显示装箱阵列";
  return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 700"><defs><linearGradient id="boxAmberA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd0a3"/><stop offset=".55" stop-color="#efa159"/><stop offset="1" stop-color="#c9772f"/></linearGradient><linearGradient id="boxAmberB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc48d"/><stop offset=".65" stop-color="#e18b3e"/><stop offset="1" stop-color="#bb6928"/></linearGradient><linearGradient id="boxAmberC" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe0bd"/><stop offset=".55" stop-color="#f2b073"/><stop offset="1" stop-color="#cf7d39"/></linearGradient><linearGradient id="boxAmberD" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffc08c"/><stop offset=".55" stop-color="#dd8538"/><stop offset="1" stop-color="#ad5f23"/></linearGradient><linearGradient id="cartonWall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2bf8d"/><stop offset=".55" stop-color="#b78952"/><stop offset="1" stop-color="#775536"/></linearGradient><pattern id="foamFill" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#a8ddd3"/><path d="M0 6H12M6 0V12" stroke="#effffb" stroke-width=".8" opacity=".5"/><circle cx="3" cy="3" r="1" fill="#fff" opacity=".55"/></pattern><filter id="softShadow" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#17324d" flood-opacity=".15"/></filter></defs><rect width="920" height="700" rx="18" fill="#f4f7fb"/><text x="28" y="38" font-family="Microsoft YaHei,Arial" font-size="20" font-weight="700" fill="#10283e">${title}</text><text x="28" y="64" font-family="Microsoft YaHei,Arial" font-size="15" fill="#50677a">装配方向：长向 ${nx} × 宽向 ${ny} × 高向 ${nz} = ${l.quantity} pcs · 内盒朝向 ${l.orientation.join("×")} mm</text><g filter="url(#softShadow)">${body}</g>${labels}<g font-family="Microsoft YaHei,Arial" font-size="14" fill="#50677a"><text x="28" y="655">${foamLegend}</text><text x="28" y="680">L=长向（左/右） · W=宽向（前/后） · H=高向（上/下） · 单位 mm</text></g></svg>`;
}
function svgPreview(data){
  const {carton:c,layout:l}=data.best,[nx,ny,nz]=l.counts,[bl,bw,bh]=l.orientation;
  const hasFoam=!!foamFaceMap(c);
  const cleanSize=value=>String(value||"-").replace(/[xX*脳]/g," × ");
  const spec=axis=>{
    const rec=foamAxisRecord(c,axis),code=(rec&&rec.sku)||foamCodes(c)[axis]||"-";
    const dims=rec&&Array.isArray(rec.dimensions_mm)?rec.dimensions_mm.slice(0,3).map(v=>Number(v).toString()).join(" × "):cleanSize(foamAxisSize(c,axis,code));
    return{code,dims};
  };
  const lr=spec("length"),fb=spec("width"),tb=spec("height");
  const cube={x:Math.min(74,Math.max(38,260/Math.max(nx,1))),y:Math.min(74,Math.max(38,230/Math.max(ny,1))),z:Math.min(58,Math.max(32,230/Math.max(nz,1)))};
  const totalW=(nx*cube.x+ny*cube.y)*.62,totalH=(nx*cube.x+ny*cube.y)*.28+nz*cube.z*.9,cx=560,baseY=520+Math.min(60,totalH*.08);
  const p=(x,y,z)=>[cx+(x-y)*.62,baseY+(x+y)*.28-z*.9];
  const pts=vs=>vs.map(v=>p(...v).map(n=>n.toFixed(1)).join(",")).join(" ");
  const poly=(points,fill,stroke="#14395a",op=1)=>`<polygon points="${points}" fill="${fill}" fill-opacity="${op}" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round"/>`;
  const prism=(x,y,z,dx,dy,dz,fillA,fillB,fillC,stroke="#14395a")=>{
    const top=poly(pts([[x,y,z+dz],[x+dx,y,z+dz],[x+dx,y+dy,z+dz],[x,y+dy,z+dz]]),fillA,stroke,.98);
    const front=poly(pts([[x,y,z],[x+dx,y,z],[x+dx,y,z+dz],[x,y,z+dz]]),fillB,stroke,.98);
    const side=poly(pts([[x+dx,y,z],[x+dx,y+dy,z],[x+dx,y+dy,z+dz],[x+dx,y,z+dz]]),fillC,stroke,.98);
    return front+side+top;
  };
  const blockX=nx*cube.x,blockY=ny*cube.y,blockZ=nz*cube.z,corner=[[0,0,0],[blockX,0,0],[blockX,blockY,0],[0,blockY,0],[0,0,blockZ],[blockX,0,blockZ],[blockX,blockY,blockZ],[0,blockY,blockZ]].map(v=>p(...v));
  const line=(x1,y1,x2,y2,klass="guide")=>`<line class="${klass}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const dimArrow=(x1,y1,x2,y2,label,lx,ly)=>`${line(x1,y1,x2,y2,"dim")}<text class="dimText" x="${lx}" y="${ly}">${label}</text>`;
  const label=(x,y,w,lines)=>`<g class="label"><rect x="${x}" y="${y}" width="${w}" height="${lines.length>1?68:44}" rx="9"/><text x="${x+18}" y="${y+25}">${lines.map((t,i)=>`<tspan x="${x+18}" dy="${i?22:0}">${esc(t)}</tspan>`).join("")}</text></g>`;
  const dot=(x,y)=>`<circle class="dot" cx="${x}" cy="${y}" r="5"/>`;
  const topPanel=`<g class="foam">${poly("445,165 610,115 775,165 610,218","url(#foamPattern)","#277568")}</g>`;
  const bottomPanel=`<g class="foam">${poly("455,645 610,600 765,645 610,704","url(#foamPattern)","#277568")}</g>`;
  const leftPanel=`<g class="foam">${poly("326,300 382,273 382,512 326,542","url(#foamPattern)","#277568")}</g>`;
  const rightPanel=`<g class="foam">${poly("794,273 850,300 850,542 794,512","url(#foamPattern)","#277568")}</g>`;
  const frontPanel=`<g class="foam">${poly("365,560 504,515 504,650 365,694","url(#foamPattern)","#277568")}</g>`;
  const backPanel=`<g class="foam">${poly("716,515 855,560 855,694 716,650","url(#foamPattern)","#277568")}</g>`;
  const carton=`<g class="carton">
    <polygon points="360,735 560,650 760,735 560,825" fill="#b6844d" opacity=".42" stroke="#7c5832"/>
    <polygon points="560,650 760,735 760,805 560,895" fill="#9b6b38" opacity=".52" stroke="#7c5832"/>
    <polygon points="360,735 560,825 560,895 360,805" fill="#c99557" opacity=".58" stroke="#7c5832"/>
    <polygon points="360,735 210,695 410,616 560,650" fill="#d7aa70" opacity=".82" stroke="#7c5832"/>
    <polygon points="760,735 910,695 710,616 560,650" fill="#d7aa70" opacity=".82" stroke="#7c5832"/>
    <polygon points="360,735 560,650 560,590 330,670" fill="#e0b980" opacity=".76" stroke="#7c5832"/>
    <polygon points="760,735 560,650 560,590 790,670" fill="#e0b980" opacity=".76" stroke="#7c5832"/>
  </g>`;
  let boxes="";
  const colors=[["#ffe28a","#f05aaf","#7580ee"],["#fff0a8","#f37ac0","#8c93f2"]];
  const cells=[];for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)cells.push([i,j,k]);
  cells.sort((a,b)=>(a[0]+a[1]+a[2])-(b[0]+b[1]+b[2]));
  for(const [i,j,k] of cells){
    const set=colors[(i+j+k)%2],x=i*cube.x,y=j*cube.y,z=k*cube.z;
    boxes+=prism(x,y,z,cube.x,cube.y,cube.z,set[0],set[1],set[2]);
  }
  const envelope=`<g class="envelope">${[line(corner[0][0],corner[0][1],corner[4][0],corner[4][1]),line(corner[1][0],corner[1][1],corner[5][0],corner[5][1]),line(corner[2][0],corner[2][1],corner[6][0],corner[6][1]),line(corner[3][0],corner[3][1],corner[7][0],corner[7][1]),line(corner[4][0],corner[4][1],corner[5][0],corner[5][1]),line(corner[5][0],corner[5][1],corner[6][0],corner[6][1]),line(corner[6][0],corner[6][1],corner[7][0],corner[7][1]),line(corner[7][0],corner[7][1],corner[4][0],corner[4][1])].join("")}</g>`;
  const foamShapes=hasFoam?topPanel+bottomPanel+leftPanel+rightPanel+frontPanel+backPanel:"";
  const foamLabels=hasFoam?`
    ${line(610,165,610,100,"leader")}${dot(610,165)}${label(465,34,290,[`上/下  ${tb.code}`,`${tb.dims} mm`])}
    ${line(326,420,272,348,"leader")}${dot(326,420)}${label(34,305,230,[`左/右  ${lr.code}`,`${lr.dims} mm`])}
    ${line(850,420,902,348,"leader")}${dot(850,420)}${label(856,305,230,[`左/右  ${lr.code}`,`${lr.dims} mm`])}
    ${line(430,610,330,614,"leader")}${dot(430,610)}${label(84,585,250,[`前/后  ${fb.code}`,`${fb.dims} mm`])}
    ${line(788,610,878,614,"leader")}${dot(788,610)}${label(830,585,250,[`前/后  ${fb.code}`,`${fb.dims} mm`])}
    ${line(610,648,610,730,"leader")}${dot(610,648)}${label(465,725,290,[`上/下  ${tb.code}`,`${tb.dims} mm`])}`:`
    <g class="noFoam"><rect x="368" y="114" width="384" height="54" rx="12"/><text x="560" y="148">当前箱型无配套珍珠棉记录，仅显示内盒装配方向</text></g>`;
  const material=String(c.material||c.flute||String(c.name||"").match(/K=K|K6K|K3KE?|BC|BE/)?.[0]||"").trim();
  const sizeNote=esc([c.code&&c.code!=="*" ? c.code : c.sku||"",Array.isArray(c.outer)?`${c.outer.join("×")} mm`:"",material].filter(Boolean).join(" · "));
  return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 900" preserveAspectRatio="xMidYMid meet" role="img" aria-label="工程预览">
    <defs>
      <linearGradient id="bgPreview" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8fbff"/><stop offset="1" stop-color="#eef4fa"/></linearGradient>
      <pattern id="foamPattern" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="#bde9df"/><path d="M0 7H14M7 0V14" stroke="#f4fffc" stroke-width="1" opacity=".7"/><circle cx="3.5" cy="3.5" r="1.1" fill="#fff" opacity=".7"/></pattern>
      <filter id="previewShadow" x="-20%" y="-20%" width="140%" height="145%"><feDropShadow dx="0" dy="14" stdDeviation="15" flood-color="#12304c" flood-opacity=".16"/></filter>
      <marker id="arrowPreview" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="#183f74"/></marker>
      <style>
        .title{font:700 22px "Microsoft YaHei",Arial,sans-serif;fill:#10283e}.sub{font:500 15px "Microsoft YaHei",Arial,sans-serif;fill:#51697d}.dimText{font:700 21px "Microsoft YaHei",Arial,sans-serif;fill:#123b67}.dim,.leader{stroke:#183f74;stroke-width:2;fill:none;marker-end:url(#arrowPreview)}.leader{stroke:#20805f;marker-end:none}.guide{stroke:#1d4e83;stroke-width:1.6;stroke-dasharray:8 8;fill:none;opacity:.8}.label rect{fill:#fbfffd;stroke:#3e9a78;stroke-width:1.5}.label text{font:700 18px "Microsoft YaHei",Arial,sans-serif;fill:#152b39}.label tspan:first-child{fill:#087146}.dot{fill:#087146}.foam{filter:url(#previewShadow)}.carton{filter:url(#previewShadow)}.footer rect,.legend .legendBg{fill:#fff;stroke:#d7e0e6}.legend .swatch{fill:url(#foamPattern);stroke:#3e9a78}.footer text{font:700 25px "Microsoft YaHei",Arial,sans-serif;fill:#10283e}.legend text{font:700 16px "Microsoft YaHei",Arial,sans-serif;fill:#10283e}.legend .green{fill:#087146}.noFoam rect{fill:#fff;stroke:#d7e0e6}.noFoam text{font:700 17px "Microsoft YaHei",Arial,sans-serif;fill:#51697d;text-anchor:middle}
      </style>
    </defs>
    <rect width="1120" height="900" rx="28" fill="url(#bgPreview)"/>
    <text class="title" x="40" y="45">${sizeNote}</text>
    <text class="sub" x="40" y="73">内盒朝向 ${esc(l.orientation.join(" × "))} mm · 单位 mm</text>
    ${dimArrow(360,128,488,88,"L  长向",385,88)}${dimArrow(760,128,632,88,"W  宽向",720,88)}${dimArrow(900,245,900,480,"H  高向",922,372)}
    ${carton}
    ${foamShapes}
    <g filter="url(#previewShadow)">${boxes}</g>
    ${envelope}
    ${foamLabels}
    <g class="legend"><rect class="legendBg" x="40" y="755" width="335" height="70" rx="10"/><rect class="swatch" x="58" y="774" width="34" height="34" rx="4"/><text x="110" y="788" class="green">配套珍珠棉：</text><text x="110" y="812">${hasFoam?"6片（左/右、前/后、上/下各1片）":"无配套珍珠棉记录"}</text></g>
    <g class="footer"><rect x="312" y="825" width="496" height="54" rx="12"/><text x="560" y="860" text-anchor="middle">装配方向：长向 ${nx} × 宽向 ${ny} × 高向 ${nz} = ${l.quantity} pcs</text></g>
  </svg>`;
}
function svgPreviewV2(data){
  const {carton:c,layout:l}=data.best,[nx,ny,nz]=l.counts,pad=l.padding;
  const txt={preview:"\u5de5\u7a0b\u9884\u89c8",inner:"\u5185\u76d2\u671d\u5411",unit:"\u5355\u4f4d",length:"\u957f\u5411",width:"\u5bbd\u5411",height:"\u9ad8\u5411",left:"\u5de6",right:"\u53f3",front:"\u524d",back:"\u540e",top:"\u4e0a",bottom:"\u4e0b",foam:"\u914d\u5957\u73cd\u73e0\u68c9",none:"\u5f53\u524d\u65b9\u6848\u672a\u653e\u7f6e\u73cd\u73e0\u68c9",noMap:"\u5f53\u524d\u7bb1\u578b\u65e0\u914d\u5957\u73cd\u73e0\u68c9\u8bb0\u5f55",assembly:"\u88c5\u914d\u65b9\u5411",pieces:"\u7247"};
  const xMark="\u00d7",middleDot="\u00b7",hasMap=!!foamFaceMap(c);
  const cleanSize=value=>String(value||"-").replace(/[xX*\u8133\u00d7]/g,` ${xMark} `).replace(/\s+/g," ").trim();
  const spec=axis=>{
    const rec=foamAxisRecord(c,axis),code=(rec&&rec.sku)||foamCodes(c)[axis]||"-";
    const dims=rec&&Array.isArray(rec.dimensions_mm)?rec.dimensions_mm.slice(0,3).map(v=>Number(v).toString()).join(` ${xMark} `):cleanSize(foamAxisSize(c,axis,code));
    return{code,dims};
  };
  const lr=spec("length"),fb=spec("width"),tb=spec("height");
  const faces=[
    {name:txt.top,count:pad.height.high,spec:tb,shape:"445,165 610,115 775,165 610,218",dot:[610,165],label:[465,34,290],leader:[610,165,610,100]},
    {name:txt.left,count:pad.length.low,spec:lr,shape:"326,300 382,273 382,512 326,542",dot:[326,420],label:[34,305,230],leader:[326,420,272,348]},
    {name:txt.right,count:pad.length.high,spec:lr,shape:"794,273 850,300 850,542 794,512",dot:[850,420],label:[856,305,230],leader:[850,420,902,348]},
    {name:txt.front,count:pad.width.low,spec:fb,shape:"365,560 504,515 504,650 365,694",dot:[430,610],label:[84,585,250],leader:[430,610,330,614]},
    {name:txt.back,count:pad.width.high,spec:fb,shape:"716,515 855,560 855,694 716,650",dot:[788,610],label:[830,585,250],leader:[788,610,878,614]},
    {name:txt.bottom,count:pad.height.low,spec:tb,shape:"455,645 610,600 765,645 610,704",dot:[610,648],label:[465,725,290],leader:[610,648,610,730]}
  ];
  const cube={x:Math.min(74,Math.max(38,260/Math.max(nx,1))),y:Math.min(74,Math.max(38,230/Math.max(ny,1))),z:Math.min(58,Math.max(32,230/Math.max(nz,1)))};
  const totalH=(nx*cube.x+ny*cube.y)*.28+nz*cube.z*.9,cx=560,baseY=520+Math.min(60,totalH*.08);
  const project=(x,y,z)=>[cx+(x-y)*.62,baseY+(x+y)*.28-z*.9];
  const pts=vs=>vs.map(v=>project(...v).map(n=>n.toFixed(1)).join(",")).join(" ");
  const poly=(points,fill,stroke="#14395a",op=1)=>`<polygon points="${points}" fill="${fill}" fill-opacity="${op}" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round"/>`;
  const prism=(x,y,z,dx,dy,dz,fillA,fillB,fillC,stroke="#14395a")=>poly(pts([[x,y,z],[x+dx,y,z],[x+dx,y,z+dz],[x,y,z+dz]]),fillB,stroke,.98)+poly(pts([[x+dx,y,z],[x+dx,y+dy,z],[x+dx,y+dy,z+dz],[x+dx,y,z+dz]]),fillC,stroke,.98)+poly(pts([[x,y,z+dz],[x+dx,y,z+dz],[x+dx,y+dy,z+dz],[x,y+dy,z+dz]]),fillA,stroke,.98);
  const blockX=nx*cube.x,blockY=ny*cube.y,blockZ=nz*cube.z,corner=[[0,0,0],[blockX,0,0],[blockX,blockY,0],[0,blockY,0],[0,0,blockZ],[blockX,0,blockZ],[blockX,blockY,blockZ],[0,blockY,blockZ]].map(v=>project(...v));
  const line=(x1,y1,x2,y2,klass="guide")=>`<line class="${klass}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const dimArrow=(x1,y1,x2,y2,label,lx,ly)=>`${line(x1,y1,x2,y2,"dim")}<text class="dimText" x="${lx}" y="${ly}">${esc(label)}</text>`;
  const label=(x,y,w,lines)=>`<g class="label"><rect x="${x}" y="${y}" width="${w}" height="${Math.max(42,24+lines.length*22)}" rx="9"/><text x="${x+16}" y="${y+26}">${lines.map((t,i)=>`<tspan x="${x+16}" dy="${i?22:0}">${esc(t)}</tspan>`).join("")}</text></g>`;
  const dot=(x,y)=>`<circle class="dot" cx="${x}" cy="${y}" r="5"/>`;
  const panel=f=>`<g class="foam">${poly(f.shape,"url(#foamPattern)","#277568")}</g>`;
  const faceLabel=f=>`${f.name} ${f.spec.code}${f.count>1?` ${xMark}${f.count}`:""}`;
  const carton=`<g class="carton">
    <polygon points="360,735 560,650 760,735 560,825" fill="#b6844d" opacity=".42" stroke="#7c5832"/>
    <polygon points="560,650 760,735 760,805 560,895" fill="#9b6b38" opacity=".52" stroke="#7c5832"/>
    <polygon points="360,735 560,825 560,895 360,805" fill="#c99557" opacity=".58" stroke="#7c5832"/>
    <polygon points="360,735 210,695 410,616 560,650" fill="#d7aa70" opacity=".82" stroke="#7c5832"/>
    <polygon points="760,735 910,695 710,616 560,650" fill="#d7aa70" opacity=".82" stroke="#7c5832"/>
    <polygon points="360,735 560,650 560,590 330,670" fill="#e0b980" opacity=".76" stroke="#7c5832"/>
    <polygon points="760,735 560,650 560,590 790,670" fill="#e0b980" opacity=".76" stroke="#7c5832"/>
  </g>`;
  const facePoly=(vs,fill)=>poly(vs.map(q=>q.map(n=>n.toFixed(1)).join(",")).join(" "),fill,"#14395a",.98);
  const grid=(a,b)=>line(a[0].toFixed(1),a[1].toFixed(1),b[0].toFixed(1),b[1].toFixed(1),"boxGrid");
  const block=()=>{
    const A=project(0,0,0),B=project(blockX,0,0),C=project(blockX,blockY,0),D=project(0,blockY,0),E=project(0,0,blockZ),F=project(blockX,0,blockZ),G=project(blockX,blockY,blockZ),H=project(0,blockY,blockZ);
    let out=`<g class="innerBlock">`;
    out+=facePoly([A,D,H,E],"url(#innerPink)");
    out+=facePoly([B,C,G,F],"url(#innerBlue)");
    out+=facePoly([E,F,G,H],"url(#innerTop)");
    for(let i=1;i<nx;i++){
      out+=grid(project(i*cube.x,0,blockZ),project(i*cube.x,blockY,blockZ));
    }
    for(let j=1;j<ny;j++){
      out+=grid(project(0,j*cube.y,0),project(0,j*cube.y,blockZ));
      out+=grid(project(blockX,j*cube.y,0),project(blockX,j*cube.y,blockZ));
      out+=grid(project(0,j*cube.y,blockZ),project(blockX,j*cube.y,blockZ));
    }
    for(let k=1;k<nz;k++){
      out+=grid(project(0,0,k*cube.z),project(0,blockY,k*cube.z));
      out+=grid(project(blockX,0,k*cube.z),project(blockX,blockY,k*cube.z));
    }
    return out+`</g>`;
  };
  const boxes=block();
  const envelope=`<g class="envelope">${[line(corner[0][0],corner[0][1],corner[4][0],corner[4][1]),line(corner[1][0],corner[1][1],corner[5][0],corner[5][1]),line(corner[2][0],corner[2][1],corner[6][0],corner[6][1]),line(corner[3][0],corner[3][1],corner[7][0],corner[7][1]),line(corner[4][0],corner[4][1],corner[5][0],corner[5][1]),line(corner[5][0],corner[5][1],corner[6][0],corner[6][1]),line(corner[6][0],corner[6][1],corner[7][0],corner[7][1]),line(corner[7][0],corner[7][1],corner[4][0],corner[4][1])].join("")}</g>`;
  const activeFaces=hasMap?faces.filter(f=>f.count>0):[],totalFoam=faces.reduce((sum,f)=>sum+Math.max(0,Number(f.count)||0),0);
  const foamShapes=activeFaces.map(panel).join("");
  const foamLabels=hasMap?activeFaces.filter(f=>f.count>1).map(f=>`${line(...f.leader,"leader")}${dot(...f.dot)}${label(...f.label,[faceLabel(f)])}`).join(""):`<g class="noFoam"><rect x="368" y="114" width="384" height="54" rx="12"/><text x="560" y="148">${txt.noMap}</text></g>`;
  const material=String(c.material||c.flute||String(c.name||"").match(/K=K|K6K|K3KE?|BC|BE/)?.[0]||"").trim();
  const sizeNote=esc([c.code&&c.code!=="*" ? c.code : c.sku||"",Array.isArray(c.outer)?`${c.outer.join(xMark)} mm`:"",material].filter(Boolean).join(` ${middleDot} `));
  const legendText=hasMap&&totalFoam>0?`${totalFoam}${txt.pieces} (${txt.left}${pad.length.low}/${txt.right}${pad.length.high}, ${txt.front}${pad.width.low}/${txt.back}${pad.width.high}, ${txt.top}${pad.height.high}/${txt.bottom}${pad.height.low})`:hasMap?txt.none:txt.noMap;
  return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 900" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${txt.preview}">
    <defs>
      <linearGradient id="bgPreview" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8fbff"/><stop offset="1" stop-color="#eef4fa"/></linearGradient>
      <linearGradient id="innerPink" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8bc8"/><stop offset="1" stop-color="#df4e9c"/></linearGradient>
      <linearGradient id="innerBlue" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9ca4ff"/><stop offset="1" stop-color="#5f6fe8"/></linearGradient>
      <linearGradient id="innerTop" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1a8"/><stop offset="1" stop-color="#ffd65e"/></linearGradient>
      <pattern id="foamPattern" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="#bde9df"/><path d="M0 7H14M7 0V14" stroke="#f4fffc" stroke-width="1" opacity=".7"/><circle cx="3.5" cy="3.5" r="1.1" fill="#fff" opacity=".7"/></pattern>
      <filter id="previewShadow" x="-20%" y="-20%" width="140%" height="145%"><feDropShadow dx="0" dy="14" stdDeviation="15" flood-color="#12304c" flood-opacity=".16"/></filter>
      <marker id="arrowPreview" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="#183f74"/></marker>
      <style>
        .title{font:700 22px "Microsoft YaHei",Arial,sans-serif;fill:#10283e}.sub{font:500 15px "Microsoft YaHei",Arial,sans-serif;fill:#51697d}.dimText{font:700 21px "Microsoft YaHei",Arial,sans-serif;fill:#123b67}.dim,.leader{stroke:#183f74;stroke-width:2;fill:none;marker-end:url(#arrowPreview)}.leader{stroke:#20805f;marker-end:none}.guide{stroke:#1d4e83;stroke-width:1.6;stroke-dasharray:8 8;fill:none;opacity:.8}.boxGrid{stroke:#14395a;stroke-width:1.5;fill:none;opacity:.92}.innerBlock{filter:url(#previewShadow)}.label rect{fill:#fbfffd;stroke:#3e9a78;stroke-width:1.5}.label text{font:700 17px "Microsoft YaHei",Arial,sans-serif;fill:#087146}.dot{fill:#087146}.foam{filter:url(#previewShadow)}.carton{filter:url(#previewShadow)}.footer rect,.legend .legendBg{fill:#fff;stroke:#d7e0e6}.legend .swatch{fill:url(#foamPattern);stroke:#3e9a78}.footer text{font:700 25px "Microsoft YaHei",Arial,sans-serif;fill:#10283e}.legend text{font:700 16px "Microsoft YaHei",Arial,sans-serif;fill:#10283e}.legend .green{fill:#087146}.noFoam rect{fill:#fff;stroke:#d7e0e6}.noFoam text{font:700 17px "Microsoft YaHei",Arial,sans-serif;fill:#51697d;text-anchor:middle}
      </style>
    </defs>
    <rect width="1120" height="900" rx="28" fill="url(#bgPreview)"/>
    <text class="title" x="40" y="45">${sizeNote}</text>
    <text class="sub" x="40" y="73">${txt.inner} ${esc(l.orientation.join(` ${xMark} `))} mm ${middleDot} ${txt.unit} mm</text>
    ${dimArrow(360,128,488,88,`L  ${txt.length}`,385,88)}${dimArrow(760,128,632,88,`W  ${txt.width}`,720,88)}${dimArrow(900,245,900,480,`H  ${txt.height}`,922,372)}
    ${carton}
    ${foamShapes}
    <g filter="url(#previewShadow)">${boxes}</g>
    ${envelope}
    ${foamLabels}
    <g class="legend"><rect class="legendBg" x="40" y="755" width="390" height="70" rx="10"/><rect class="swatch" x="58" y="774" width="34" height="34" rx="4"/><text x="110" y="788" class="green">${txt.foam}:</text><text x="110" y="812">${esc(legendText)}</text></g>
    <g class="footer"><rect x="312" y="825" width="496" height="54" rx="12"/><text x="560" y="860" text-anchor="middle">${txt.assembly}: ${txt.length} ${nx} ${xMark} ${txt.width} ${ny} ${xMark} ${txt.height} ${nz} = ${l.quantity} pcs</text></g>
  </svg>`;
}
function svgPreviewV3(data){
  const {carton:c,layout:l}=data.best,[nx,ny,nz]=l.counts,pad=l.padding;
  const xMark="\u00d7",txt={length:"\u957f\u5411",width:"\u5bbd\u5411",height:"\u9ad8\u5411",assembly:"\u88c5\u914d\u65b9\u5411",left:"\u5de6",right:"\u53f3",front:"\u524d",back:"\u540e",top:"\u4e0a",bottom:"\u4e0b"};
  const spec=axis=>{const rec=foamAxisRecord(c,axis),code=(rec&&rec.sku)||foamCodes(c)[axis]||"";return code};
  const codes={length:spec("length"),width:spec("width"),height:spec("height")};
  const faces=[
    {name:txt.top,count:pad.height.high,code:codes.height,shape:[[462,182],[610,132],[758,182],[610,235]],badge:[610,102]},
    {name:txt.bottom,count:pad.height.low,code:codes.height,shape:[[475,612],[610,568],[745,612],[610,666]],badge:[610,680]},
    {name:txt.left,count:pad.length.low,code:codes.length,shape:[[292,318],[356,292],[356,525],[292,558]],badge:[172,348]},
    {name:txt.right,count:pad.length.high,code:codes.length,shape:[[828,292],[892,318],[892,558],[828,525]],badge:[930,348]},
    {name:txt.front,count:pad.width.low,code:codes.width,shape:[[346,550],[496,503],[496,642],[346,690]],badge:[166,610]},
    {name:txt.back,count:pad.width.high,code:codes.width,shape:[[724,503],[874,550],[874,690],[724,642]],badge:[926,610]}
  ];
  const svgPts=pts=>pts.map(p=>p.map(n=>n.toFixed(1)).join(",")).join(" ");
  const poly=(pts,cls)=>`<polygon class="${cls}" points="${svgPts(pts)}"/>`;
  const panel=f=>{
    if(!f.count)return "";
    const copies=Math.min(3,Math.max(1,Number(f.count)||0));
    let out=`<g class="foamGroup">`;
    for(let i=copies-1;i>=0;i--){
      const dx=i*5,dy=-i*5;
      out+=poly(f.shape.map(([x,y])=>[x+dx,y+dy]),"foamPanel");
    }
    if(f.count>1)out+=`<g class="badge"><rect x="${f.badge[0]-78}" y="${f.badge[1]-20}" width="156" height="38" rx="9"/><text x="${f.badge[0]}" y="${f.badge[1]+5}" text-anchor="middle">${esc(`${f.name} ${f.code} ${xMark}${f.count}`)}</text></g>`;
    return out+`</g>`;
  };
  const cx=610,baseY=465,W=230,D=145,H=245,px=(x,y,z)=>[cx+(x-y)*.76,baseY+(x+y)*.34-z];
  const A=px(0,0,0),B=px(W,0,0),C=px(W,D,0),D0=px(0,D,0),E=px(0,0,H),F=px(W,0,H),G=px(W,D,H),H0=px(0,D,H);
  const line=(a,b,cls="grid")=>`<line class="${cls}" x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`;
  let block=`<g class="innerBlock">${poly([A,B,F,E],"innerPink")}${poly([B,C,G,F],"innerBlue")}${poly([E,F,G,H0],"innerTop")}`;
  for(let i=1;i<nx;i++){block+=line(px(i*W/nx,0,H),px(i*W/nx,D,H));block+=line(px(i*W/nx,0,0),px(i*W/nx,0,H))}
  for(let j=1;j<ny;j++){block+=line(px(W,j*D/ny,0),px(W,j*D/ny,H));block+=line(px(0,j*D/ny,H),px(W,j*D/ny,H))}
  for(let k=1;k<nz;k++){block+=line(px(0,0,k*H/nz),px(W,0,k*H/nz));block+=line(px(W,0,k*H/nz),px(W,D,k*H/nz))}
  block+=`</g>`;
  const carton=`<g class="carton">
    <polygon class="cartonInside" points="390,690 610,592 830,690 610,790"/>
    <polygon class="cartonFront" points="390,690 610,790 610,858 390,755"/>
    <polygon class="cartonSide" points="830,690 610,790 610,858 830,755"/>
    <polygon class="flap" points="390,690 230,642 450,552 610,592"/>
    <polygon class="flap" points="830,690 990,642 770,552 610,592"/>
    <polygon class="flap" points="390,690 610,592 610,535 360,625"/>
    <polygon class="flap" points="830,690 610,592 610,535 860,625"/>
    <polyline class="cartonRim" points="390,690 610,592 830,690 610,790 390,690"/>
  </g>`;
  const totalFoam=faces.reduce((s,f)=>s+(Number(f.count)||0),0),material=String(c.material||c.flute||String(c.name||"").match(/K=K|K6K|K3KE?|BC|BE/)?.[0]||"").trim();
  const title=esc([c.code&&c.code!=="*" ? c.code : c.sku||"",Array.isArray(c.outer)?`${c.outer.join(xMark)} mm`:"",material].filter(Boolean).join(" \u00b7 "));
  return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 900" preserveAspectRatio="xMidYMid meet" role="img" aria-label="engineering preview">
    <defs>
      <linearGradient id="bgV3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8fbff"/><stop offset="1" stop-color="#eef4fa"/></linearGradient>
      <linearGradient id="pinkV3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8dcc"/><stop offset="1" stop-color="#df4a9a"/></linearGradient>
      <linearGradient id="blueV3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a0a7ff"/><stop offset="1" stop-color="#596be6"/></linearGradient>
      <linearGradient id="topV3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4a9"/><stop offset="1" stop-color="#ffd45d"/></linearGradient>
      <pattern id="foamV3" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#c4eee5"/><path d="M0 8H16M8 0V16" stroke="#f7fffd" stroke-width="1"/><circle cx="4" cy="4" r="1.2" fill="#fff" opacity=".75"/></pattern>
      <filter id="shadowV3" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="14" stdDeviation="15" flood-color="#12304c" flood-opacity=".16"/></filter>
      <style>
        .title{font:700 22px "Microsoft YaHei",Arial,sans-serif;fill:#10283e}.sub{font:500 15px "Microsoft YaHei",Arial,sans-serif;fill:#51697d}.innerBlock,.carton,.foamGroup{filter:url(#shadowV3)}.innerPink{fill:url(#pinkV3);stroke:#14395a;stroke-width:2}.innerBlue{fill:url(#blueV3);stroke:#14395a;stroke-width:2}.innerTop{fill:url(#topV3);stroke:#14395a;stroke-width:2}.grid{stroke:#14395a;stroke-width:1.6;opacity:.9}.foamPanel{fill:url(#foamV3);stroke:#24786a;stroke-width:2}.cartonInside{fill:#b98750;opacity:.42;stroke:#795633;stroke-width:1.8}.cartonFront{fill:#c99860;opacity:.82;stroke:#795633;stroke-width:1.8}.cartonSide{fill:#9b6c3e;opacity:.82;stroke:#795633;stroke-width:1.8}.flap{fill:#dfb777;opacity:.9;stroke:#795633;stroke-width:1.8}.cartonRim{fill:none;stroke:#5f4227;stroke-width:2.2}.badge rect{fill:#fbfffd;stroke:#3e9a78;stroke-width:1.6}.badge text{font:700 17px "Microsoft YaHei",Arial,sans-serif;fill:#087146}.footer rect{fill:#fff;stroke:#d7e0e6}.footer text{font:700 26px "Microsoft YaHei",Arial,sans-serif;fill:#10283e}
      </style>
    </defs>
    <rect width="1120" height="900" rx="28" fill="url(#bgV3)"/>
    <text class="title" x="40" y="48">${title}</text>
    <text class="sub" x="40" y="75">${esc(`EPE ${totalFoam}`)} \u7247</text>
    ${carton}
    ${faces.map(panel).join("")}
    ${block}
    <g class="footer"><rect x="290" y="825" width="540" height="56" rx="12"/><text x="560" y="862" text-anchor="middle">${txt.assembly}: ${txt.length} ${nx} ${xMark} ${txt.width} ${ny} ${xMark} ${txt.height} ${nz} = ${l.quantity} pcs</text></g>
  </svg>`;
}
function svgMixedPreview(data){
  const {carton:c,layout:l}=data.best,[cl,cw,ch]=c.inner,d=l.orientationDistribution||{rotation0:0,rotation90:0};
  const margin=70,scale=Math.min(920/cl,560/cw),w=cl*scale,h=cw*scale,ox=(1120-w)/2,oy=120;
  const boxes=placedBoxesForLayout(l).filter(b=>Math.abs(b.z)<1e-9);
  const rect=b=>`<g><rect x="${(ox+b.x*scale).toFixed(1)}" y="${(oy+b.y*scale).toFixed(1)}" width="${(b.length*scale).toFixed(1)}" height="${(b.width*scale).toFixed(1)}" rx="4" class="${b.rotation===90?"box90":"box0"}"/><line x1="${(ox+(b.x+b.length*.25)*scale).toFixed(1)}" y1="${(oy+(b.y+b.width*.5)*scale).toFixed(1)}" x2="${(ox+(b.x+b.length*.75)*scale).toFixed(1)}" y2="${(oy+(b.y+b.width*.5)*scale).toFixed(1)}" class="${b.rotation===90?"arrow90":"arrow0"}"/></g>`;
  const title=esc([c.code&&c.code!=="*"?c.code:c.sku||"",c.name].filter(Boolean).join(" · "));
  return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 820" role="img" aria-label="mixed orientation flat packing preview"><defs><style>text{font-family:"Microsoft YaHei",Arial,sans-serif}.carton{fill:#fff8ec;stroke:#765335;stroke-width:2.5}.box0{fill:#ffbd73;stroke:#9c4d13;stroke-width:1.6}.box90{fill:#8ea0ff;stroke:#223fae;stroke-width:1.6}.arrow0{stroke:#9c4d13;stroke-width:3}.arrow90{stroke:#223fae;stroke-width:3}.label{fill:#10283e;font-weight:800}.muted{fill:#51697d}.legend rect{stroke-width:1.5}</style></defs><rect width="1120" height="820" rx="28" fill="#f4f7fb"/><text x="54" y="56" font-size="24" class="label">${title}</text><text x="54" y="88" font-size="16" class="muted">平放长宽混排 · 外箱内尺寸 ${cl}×${cw}×${ch} mm · 每层 ${boxes.length} 个 · 共 ${l.quantity} 个</text><rect x="${ox.toFixed(1)}" y="${oy.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" class="carton"/><g>${boxes.map(rect).join("")}</g><g class="legend"><rect x="54" y="714" width="22" height="16" class="box0"/><text x="86" y="728" font-size="16" class="muted">0° ${d.rotation0} 个</text><rect x="190" y="714" width="22" height="16" class="box90"/><text x="222" y="728" font-size="16" class="muted">90° ${d.rotation90} 个</text><text x="54" y="766" font-size="18" class="label">体积利用率 ${(l.utilization*100).toFixed(2)}% · 底面积利用率 ${((l.areaUtilization||0)*100).toFixed(2)}% · 剩余空间 ${l.residual.join("×")} mm</text></g></svg>`;
}
// Clean, fixed 2.5D assembly preview. Counts are labels, never repeated panels.
function svgPreviewV4(data){
  const {carton:c,layout:l}=data.best,[nx,ny,nz]=l.counts,pad=l.padding,xMark="\u00d7";
  if(l.mode==="mixedOrientationFlat")return svgMixedPreview(data);
  const txt={assembly:"\u88c5\u914d\u65b9\u5411",length:"\u957f\u5411",width:"\u5bbd\u5411",height:"\u9ad8\u5411",left:"\u5de6",right:"\u53f3",front:"\u524d",back:"\u540e",top:"\u4e0a",bottom:"\u4e0b"};
  const codeFor=axis=>foamAxisRecord(c,axis)?.sku||foamCodes(c)[axis]||"";
  const faces=[
    {name:txt.top,count:+pad.height.high||0,code:codeFor("height"),shape:[[434,126],[600,68],[766,126],[600,184]],badge:[600,42],anchor:[600,536]},
    {name:txt.bottom,count:+pad.height.low||0,code:codeFor("height"),shape:[[434,586],[600,532],[766,586],[600,640]],badge:[600,664],anchor:[600,714]},
    {name:txt.left,count:+pad.length.low||0,code:codeFor("length"),shape:[[260,250],[322,222],[322,458],[260,489]],badge:[136,270],anchor:[360,624]},
    {name:txt.right,count:+pad.length.high||0,code:codeFor("length"),shape:[[878,222],[940,250],[940,489],[878,458]],badge:[984,270],anchor:[840,624]},
    {name:txt.front,count:+pad.width.low||0,code:codeFor("width"),shape:[[304,494],[412,452],[412,590],[304,632]],badge:[164,550],anchor:[470,670]},
    {name:txt.back,count:+pad.width.high||0,code:codeFor("width"),shape:[[788,452],[896,494],[896,632],[788,590]],badge:[956,550],anchor:[730,670]}
  ];
  const pts=a=>a.map(([x,y])=>`${x},${y}`).join(" "),poly=(a,cls)=>`<polygon class="${cls}" points="${pts(a)}"/>`,lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],line=(a,b)=>`<line class="gridV4" x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`;
  const panel=f=>{if(f.count<=0)return "";const label=f.code?`${f.name} ${f.code} ${xMark}${f.count}`:`${f.name} ${xMark}${f.count}`;const center=f.shape.reduce((s,p)=>[s[0]+p[0]/4,s[1]+p[1]/4],[0,0]);const link=f.anchor?`<line x1="${center[0]}" y1="${center[1]}" x2="${f.anchor[0]}" y2="${f.anchor[1]}" style="stroke:#2c8068;stroke-width:1.8;stroke-dasharray:7 6;fill:none"/>`:"";return `<g class="foamV4">${poly(f.shape,"foamPanelV4")}${link}${f.count>1?`<g class="badgeV4"><rect x="${f.badge[0]-102}" y="${f.badge[1]-18}" width="204" height="36" rx="9"/><text x="${f.badge[0]}" y="${f.badge[1]+6}" text-anchor="middle">${esc(label)}</text></g>`:""}</g>`};
  // One closed cuboid: a solid inner-box assembly with grids on visible faces only.
  const top=[[440,262],[600,204],[760,262],[600,320]],left=[[440,262],[600,320],[600,520],[440,466]],right=[[600,320],[760,262],[760,466],[600,520]],bottom=[[440,466],[600,520],[760,466],[600,410]];
  let block=`<g class="innerBlockV4">${poly(left,"innerPinkV4")}${poly(right,"innerBlueV4")}${poly(bottom,"innerBlueV4")}${poly(top,"innerTopV4")}`;
  for(let i=1;i<nx;i++){const t=i/nx;block+=line(lerp(top[0],top[1],t),lerp(top[3],top[2],t))+line(lerp(right[0],right[1],t),lerp(right[3],right[2],t))}
  for(let j=1;j<ny;j++){const t=j/ny;block+=line(lerp(top[0],top[3],t),lerp(top[1],top[2],t))+line(lerp(left[0],left[1],t),lerp(left[3],left[2],t))}
  for(let k=1;k<nz;k++){const t=k/nz;block+=line(lerp(left[0],left[3],t),lerp(left[1],left[2],t))+line(lerp(right[0],right[3],t),lerp(right[1],right[2],t))}
  block+="</g>";
  const carton=`<g class="cartonV4"><polygon class="cartonLeftV4" points="360,624 600,714 600,814 360,724"/><polygon class="cartonRightV4" points="840,624 600,714 600,814 840,724"/><polygon class="cartonInsideV4" points="360,624 600,536 840,624 600,714"/><polygon class="flapV4" points="360,624 600,536 548,486 292,578"/><polygon class="flapV4" points="840,624 600,536 652,486 908,578"/><polygon class="flapV4" points="360,624 600,714 600,658 316,552"/><polygon class="flapV4" points="840,624 600,714 600,658 884,552"/><polyline class="cartonRimV4" points="360,624 600,536 840,624 600,714 360,624"/></g>`;
  const totalFoam=faces.reduce((s,f)=>s+(Number(f.count)||0),0),material=String(c.material||c.flute||"");
  const title=esc([c.code&&c.code!=="*"?c.code:c.sku||"",Array.isArray(c.outer)?`${c.outer.join(xMark)} mm`:"",material].filter(Boolean).join(" · "));
  const subtitle=esc(`\u5185\u76d2 ${l.orientation.join(" × ")} mm${l.rotation===90?"（90°长宽互换）":""} · \u73cd\u73e0\u68c9 ${totalFoam} \u7247`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 820" preserveAspectRatio="xMidYMid meet" role="img" aria-label="engineering preview"><defs><linearGradient id="bgV4" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbfdff"/><stop offset="1" stop-color="#edf4fa"/></linearGradient><linearGradient id="pinkV4" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8fc7"/><stop offset="1" stop-color="#df519e"/></linearGradient><linearGradient id="blueV4" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#aab2ff"/><stop offset="1" stop-color="#5c6fe2"/></linearGradient><linearGradient id="topV4" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4b4"/><stop offset="1" stop-color="#ffd55e"/></linearGradient><pattern id="foamPatternV4" width="18" height="18" patternUnits="userSpaceOnUse"><rect width="18" height="18" fill="#c9eee6"/><path d="M0 9H18M9 0V18" stroke="#f9fffd" stroke-width="1"/><circle cx="4.5" cy="4.5" r="1.15" fill="#fff" opacity=".72"/></pattern><filter id="shadowV4" x="-25%" y="-25%" width="150%" height="150%"><feDropShadow dx="0" dy="11" stdDeviation="11" flood-color="#14324d" flood-opacity=".16"/></filter><style>.foamV4,.innerBlockV4,.cartonV4{filter:url(#shadowV4)}.foamPanelV4{fill:url(#foamPatternV4);stroke:#277c6e;stroke-width:2}.innerPinkV4{fill:url(#pinkV4);stroke:#153c60;stroke-width:2}.innerBlueV4{fill:url(#blueV4);stroke:#153c60;stroke-width:2}.innerTopV4{fill:url(#topV4);stroke:#153c60;stroke-width:2}.gridV4{stroke:#153c60;stroke-width:1.55;fill:none}.flapV4{fill:#deb777;stroke:#765335;stroke-width:1.9}.cartonInsideV4{fill:#bf8e55;fill-opacity:.45;stroke:#765335;stroke-width:1.8}.cartonLeftV4{fill:#d1a46e;stroke:#765335;stroke-width:1.9}.cartonRightV4{fill:#a87849;stroke:#765335;stroke-width:1.9}.cartonRimV4{fill:none;stroke:#65452c;stroke-width:2.2}.badgeV4 rect{fill:#fcfffd;stroke:#3b9876;stroke-width:1.5}.badgeV4 text{font:700 16px "Microsoft YaHei",Arial,sans-serif;fill:#087146}.footerV4 rect{fill:#fff;stroke:#d5e0e8}.footerV4 text{font:700 25px "Microsoft YaHei",Arial,sans-serif;fill:#102b45}</style></defs><rect width="1120" height="820" rx="28" fill="url(#bgV4)"/>${carton}${faces.map(panel).join("")}${block}<g class="footerV4"><rect x="268" y="752" width="584" height="50" rx="12"/><text x="560" y="785" text-anchor="middle">${txt.assembly}: ${txt.length} ${nx} ${xMark} ${txt.width} ${ny} ${xMark} ${txt.height} ${nz} = ${l.quantity} pcs</text></g></svg>`;
}
function report(data){const {carton:c,layout:l}=data.best,p=l.padding,d=l.orientationDistribution||{rotation0:0,rotation90:0},foamLine=c.has_existing_foam?`- 原表配套珍珠棉：${c.foam_note||"有配套珍珠棉备注"}\n`:"",mode=l.mode==="mixedOrientationFlat"?"平放长宽混排":"统一朝向网格";return`## 输入参数
- 外箱内尺寸：长${c.inner[0]}×宽${c.inner[1]}×高${c.inner[2]} mm
- 推荐箱型：${c.name}
- 箱型信息：SKU ${c.sku||"-"}；编码 ${c.code||"-"}；材质 ${c.material||c.flute}
${foamLine}- 内盒尺寸：长${l.orientation[0]}×宽${l.orientation[1]}×高${l.orientation[2]} mm${l.rotation===90?"（90°长宽互换）":""}
- 装箱模式：${mode}${l.rotation===90?"（90°长宽互换）":""}
- 珍珠棉厚度：${data.opt.foamT}mm/片

## 最优装配方案
- 总内盒数量：${l.quantity}个
- 层数：${l.counts[2]}层；每层 ${l.counts[0]} 个
- 体积利用率：${(l.utilization*100).toFixed(2)}%
- 底面积利用率：${((l.areaUtilization||0)*100).toFixed(2)}%
- 朝向分布：0° ${d.rotation0}个；90° ${d.rotation90}个
- 相对统一朝向提升：${l.improvement>0?`+${l.improvement}`:l.improvement||0}个

## 余量分析
- 长方向余量：${l.residual[0]} mm → 左${p.length.low}片、右${p.length.high}片
- 宽方向余量：${l.residual[1]} mm → 前${p.width.low}片、后${p.width.high}片
- 高方向余量：${l.residual[2]} mm → 下${p.height.low}片、上${p.height.high}片
- 珍珠棉总片数：${l.foamTotal}片

## 人体工学校核
- 外箱三边和：${c.outer.reduce((a,b)=>a+b,0)}mm；长边：${Math.max(...c.outer)}mm；估算总重：${l.totalWeight.toFixed(2)}kg
`}
function dimKey(dims){return Array.isArray(dims)?dims.slice(0,3).map(v=>Number(v).toString()).join("×"):""}
function cartonMapKeys(c){
  const keys=[c.code,c.sku,dimKey(c.outer),dimKey(c.dimensions)];
  if(c.name){
    keys.push(c.name);
    const m=String(c.name).match(/\d+(?:\.\d+)?[×xX*]\d+(?:\.\d+)?[×xX*]\d+(?:\.\d+)?/);
    if(m)keys.push(m[0].replace(/[xX*]/g,"×"));
  }
  return [...new Set(keys.filter(Boolean).map(String))];
}
function foamFaceMap(c){
  const by=EPE_FACE_MAPS.by_carton||{},aliases=EPE_FACE_MAPS.aliases||{};
  for(const key of cartonMapKeys(c)){
    if(by[key])return by[key];
    if(aliases[key]&&by[aliases[key]])return by[aliases[key]];
  }
  const keys=cartonMapKeys(c);
  for(const value of Object.values(by)){
    if(!value||typeof value!=="object")continue;
    if(keys.includes(String(value.carton_sku||"")))return value;
    if(keys.includes(String(value.carton_dimension_key||"")))return value;
  }
  for(const [key,value] of Object.entries(by)){
    const shortKey=String(value?.carton_dimension_key||key);
    if(c.name&&(String(c.name).includes(key)||String(c.name).includes(shortKey)))return value;
    if(c.reason&&(String(c.reason).includes(key)||String(c.reason).includes(shortKey)))return value;
  }
  return null;
}
function foamAxisRecord(c,axis){
  const map=foamFaceMap(c);
  return map&&map.axes?map.axes[axis]:null;
}
function foamCodes(c){
  const mapped={length:foamAxisRecord(c,"length")?.sku||"",width:foamAxisRecord(c,"width")?.sku||"",height:foamAxisRecord(c,"height")?.sku||""};
  if(mapped.length||mapped.width||mapped.height)return mapped;
  const m=String(c.foam_note||"").match(/327\d{6}/g)||[];
  return{width:m[0]||"",length:m[1]||"",height:m[2]||""};
}
function foamSkuSize(sku){
  const rec=sku&&EPE_SKUS[String(sku)];
  const dims=rec&&Array.isArray(rec.dimensions_mm)?rec.dimensions_mm:null;
  return dims&&dims.length>=3?dims.slice(0,3).map(v=>Number(v).toString()).join("×"):"";
}
function foamAxisSize(c,axis,sku){
  const rec=foamAxisRecord(c,axis);
  return rec&&rec.dimension_key?rec.dimension_key:foamSkuSize(sku);
}
function codeText(c,axis){
  const rec=foamAxisRecord(c,axis),code=(rec&&rec.sku)||foamCodes(c)[axis];
  const size=foamAxisSize(c,axis,code);
  return code?`（${code}${size?` ${size}`:""}）`:"";
}
function foamSpec(c,axis){
  const rec=foamAxisRecord(c,axis),code=(rec&&rec.sku)||foamCodes(c)[axis]||"-";
  const size=foamAxisSize(c,axis,code)||"-";
  const face=rec&&rec.face_label?rec.face_label:axis==="length"?"左/右":axis==="width"?"前/后":"上/下";
  return{code,size,face};
}
function dxf(data){const {carton:c,layout:l}=data.best,p=l.padding,[cl,cw,ch]=c.inner,[ol,ow,oh]=c.outer,[bl,bw,bh]=l.orientation,[nl,nw,nh]=l.counts,ents=[];const clean=v=>String(v).replace(/[^\x20-\x7e]/g," ").replace(/\s+/g," ").trim();const add=a=>ents.push(...a.map(v=>String(v)));const line=(x1,y1,x2,y2,layer="OBJECT")=>add(["0","LINE","8",layer,"10",x1.toFixed(3),"20",y1.toFixed(3),"30","0","11",x2.toFixed(3),"21",y2.toFixed(3),"31","0"]);const text=(x,y,h,v)=>add(["0","TEXT","8","TEXT","10",x.toFixed(3),"20",y.toFixed(3),"30","0","40",h.toFixed(3),"1",clean(v)]);const rect=(x,y,w,h,layer="OBJECT")=>{line(x,y,x+w,y,layer);line(x+w,y,x+w,y+h,layer);line(x+w,y+h,x,y+h,layer);line(x,y+h,x,y,layer)};const ox=40,oy=80,sy=oy+cw+80;const code=(axis)=>clean(codeText(c,axis).replace(/[（）]/g,""));text(ox,30,8,"CARTON PACKING DRAWING");text(ox,45,5,`CARTON SKU ${c.sku||"-"} CODE ${c.code||"-"} OUT ${ol}x${ow}x${oh}mm IN ${cl}x${cw}x${ch}mm`);text(ox,55,5,`INNER ${data.box.dims.join("x")}mm GRID ${nl}x${nw}x${nh}=${l.quantity}pcs/carton EPE ${data.opt.foamT}mm`);text(ox,65,5,`BOM CARTON 1pcs LR ${p.length.sheets}pcs ${code("length")} FB ${p.width.sheets}pcs ${code("width")} TB ${p.height.sheets}pcs ${code("height")}`);text(ox,oy-12,5,"TOP VIEW");rect(ox,oy,cl,cw,"CARTON");const x0=ox+p.length.lowStack+p.length.unfilled/2,y0=oy+p.width.lowStack+p.width.unfilled/2;for(let j=0;j<nw;j++)for(let i=0;i<nl;i++)rect(x0+i*bl,y0+j*bw,bl,bw,"INNER_BOX");if(p.length.lowStack)rect(ox,oy,p.length.lowStack,cw,"FOAM");if(p.length.highStack)rect(ox+cl-p.length.highStack,oy,p.length.highStack,cw,"FOAM");if(p.width.lowStack)rect(ox,oy,cl,p.width.lowStack,"FOAM");if(p.width.highStack)rect(ox,oy+cw-p.width.highStack,cl,p.width.highStack,"FOAM");text(ox+cl+20,oy+cw-10,5,`LEFT ${p.length.low}pcs / RIGHT ${p.length.high}pcs EPE ${code("length")}`);text(ox+cl+20,oy+cw-20,5,`FRONT ${p.width.low}pcs / BACK ${p.width.high}pcs EPE ${code("width")}`);text(ox,sy-12,5,"SIDE VIEW");rect(ox,sy,cl,ch,"CARTON");const sx0=ox+p.length.lowStack+p.length.unfilled/2,sz0=sy+p.height.lowStack+p.height.unfilled/2;for(let k=0;k<nh;k++)for(let i=0;i<nl;i++)rect(sx0+i*bl,sz0+k*bh,bl,bh,"INNER_BOX");if(p.height.lowStack)rect(ox,sy,cl,p.height.lowStack,"FOAM");if(p.height.highStack)rect(ox,sy+ch-p.height.highStack,cl,p.height.highStack,"FOAM");text(ox+cl+20,sy+ch-10,5,`BOTTOM ${p.height.low}pcs / TOP ${p.height.high}pcs EPE ${code("height")}`);const maxX=ox+cl+260,maxY=sy+ch+90;return["0","SECTION","2","HEADER","9","$ACADVER","1","AC1009","9","$EXTMIN","10","0","20","0","30","0","9","$EXTMAX","10",maxX.toFixed(3),"20",maxY.toFixed(3),"30","0","0","ENDSEC","0","SECTION","2","TABLES","0","TABLE","2","LTYPE","70","1","0","LTYPE","2","CONTINUOUS","70","0","3","Solid line","72","65","73","0","40","0.0","0","ENDTAB","0","TABLE","2","LAYER","70","5","0","LAYER","2","0","70","0","62","7","6","CONTINUOUS","0","LAYER","2","CARTON","70","0","62","5","6","CONTINUOUS","0","LAYER","2","INNER_BOX","70","0","62","3","6","CONTINUOUS","0","LAYER","2","FOAM","70","0","62","2","6","CONTINUOUS","0","LAYER","2","TEXT","70","0","62","7","6","CONTINUOUS","0","ENDTAB","0","ENDSEC","0","SECTION","2","ENTITIES",...ents,"0","ENDSEC","0","EOF",""].join("\r\n")}
function dxf(data){
  const {carton:c,layout:l}=data.best,p=l.padding,[cl,cw,ch]=c.inner,[ol,ow,oh]=c.outer,[bl,bw,bh]=l.orientation,[nl,nw,nh]=l.counts,ents=[];
  const clean=v=>String(v).replace(/[^\x20-\x7e]/g," ").replace(/\s+/g," ").trim();
  const add=a=>ents.push(...a.map(v=>String(v)));
  const line=(x1,y1,x2,y2,layer="OBJECT")=>add(["0","LINE","8",layer,"10",x1.toFixed(3),"20",y1.toFixed(3),"30","0","11",x2.toFixed(3),"21",y2.toFixed(3),"31","0"]);
  const text=(x,y,h,v)=>add(["0","TEXT","8","TEXT","10",x.toFixed(3),"20",y.toFixed(3),"30","0","40",h.toFixed(3),"1",clean(v)]);
  const rect=(x,y,w,h,layer="OBJECT")=>{if(w<=0||h<=0)return;line(x,y,x+w,y,layer);line(x+w,y,x+w,y+h,layer);line(x+w,y+h,x,y+h,layer);line(x,y+h,x,y,layer)};
  const ox=40,oy=80,code=axis=>clean(codeText(c,axis).replace(/[（）]/g,""));
  const offX=p.length.lowStack+p.length.unfilled/2,offY=p.width.lowStack+p.width.unfilled/2,offZ=p.height.lowStack+p.height.unfilled/2;
  text(ox,30,8,"CARTON PACKING DRAWING");
  text(ox,45,5,`CARTON SKU ${c.sku||"-"} CODE ${c.code||"-"} OUT ${ol}x${ow}x${oh}mm IN ${cl}x${cw}x${ch}mm`);
  text(ox,55,5,`INNER ${l.orientation.join("x")}mm${l.rotation===90?" ROT90":""} GRID ${nl}x${nw}x${nh}=${l.quantity}pcs/carton EPE ${data.opt.foamT}mm`);
  text(ox,65,5,`BOM CARTON 1pcs LR ${p.length.sheets}pcs ${code("length")} FB ${p.width.sheets}pcs ${code("width")} TB ${p.height.sheets}pcs ${code("height")}`);
  text(ox,oy-12,5,"TOP VIEW");
  rect(ox,oy,cl,cw,"CARTON");
  if(p.length.lowStack)rect(ox,oy,p.length.lowStack,cw,"FOAM");
  if(p.length.highStack)rect(ox+cl-p.length.highStack,oy,p.length.highStack,cw,"FOAM");
  if(p.width.lowStack)rect(ox,oy,cl,p.width.lowStack,"FOAM");
  if(p.width.highStack)rect(ox,oy+cw-p.width.highStack,cl,p.width.highStack,"FOAM");
  if(l.mode==="mixedOrientationFlat"){
    const boxes=placedBoxesForLayout(l),minZ=Math.min(...boxes.map(b=>b.z)),topBoxes=boxes.filter(b=>Math.abs(b.z-minZ)<1e-6);
    topBoxes.forEach(b=>rect(ox+offX+b.x,oy+offY+b.y,b.length,b.width,mixedBoxLayer(b)));
    const hasMixed=isTrueMixedFlat(l),views=hasMixed?mixedSideViews(l,c,p):mixedSideViews(l,c,p).slice(0,1),startY=oy+cw+80,rowGap=70;
    views.forEach((view,i)=>{
      const sy=startY+i*(ch+rowGap);
      text(ox,sy-12,5,hasMixed?`SIDE ${view.key}`:"SIDE VIEW");
      rect(ox,sy,view.width,view.height,"CARTON");
      view.cells.forEach(cell=>rect(ox+cell.x,sy+view.height-cell.z-cell.h,cell.w,cell.h,mixedBoxLayer(cell.box)));
    });
    text(ox+cl+20,oy+cw-10,5,`LEFT ${p.length.low}pcs / RIGHT ${p.length.high}pcs EPE ${code("length")}`);
    text(ox+cl+20,oy+cw-20,5,`FRONT ${p.width.low}pcs / BACK ${p.width.high}pcs EPE ${code("width")}`);
    text(ox+cl+20,startY+ch-10,5,`BOTTOM ${p.height.low}pcs / TOP ${p.height.high}pcs EPE ${code("height")}`);
    const maxX=ox+Math.max(cl,cw)+260,maxY=startY+views.length*(ch+rowGap)+40;
    return dxfWrap(ents,maxX,maxY);
  }
  const x0=ox+offX,y0=oy+offY;
  for(let j=0;j<nw;j++)for(let i=0;i<nl;i++)rect(x0+i*bl,y0+j*bw,bl,bw,"INNER_BOX");
  text(ox+cl+20,oy+cw-10,5,`LEFT ${p.length.low}pcs / RIGHT ${p.length.high}pcs EPE ${code("length")}`);
  text(ox+cl+20,oy+cw-20,5,`FRONT ${p.width.low}pcs / BACK ${p.width.high}pcs EPE ${code("width")}`);
  const sy=oy+cw+80,sx0=ox+offX,sz0=sy+offZ;
  text(ox,sy-12,5,"SIDE VIEW");
  rect(ox,sy,cl,ch,"CARTON");
  if(p.height.lowStack)rect(ox,sy,cl,p.height.lowStack,"FOAM");
  if(p.height.highStack)rect(ox,sy+ch-p.height.highStack,cl,p.height.highStack,"FOAM");
  for(let k=0;k<nh;k++)for(let i=0;i<nl;i++)rect(sx0+i*bl,sz0+k*bh,bl,bh,"INNER_BOX");
  text(ox+cl+20,sy+ch-10,5,`BOTTOM ${p.height.low}pcs / TOP ${p.height.high}pcs EPE ${code("height")}`);
  return dxfWrap(ents,ox+cl+260,sy+ch+90);
}
function dxfWrap(ents,maxX,maxY){
  return["0","SECTION","2","HEADER","9","$ACADVER","1","AC1009","9","$EXTMIN","10","0","20","0","30","0","9","$EXTMAX","10",maxX.toFixed(3),"20",maxY.toFixed(3),"30","0","0","ENDSEC","0","SECTION","2","TABLES","0","TABLE","2","LTYPE","70","1","0","LTYPE","2","CONTINUOUS","70","0","3","Solid line","72","65","73","0","40","0.0","0","ENDTAB","0","TABLE","2","LAYER","70","7","0","LAYER","2","0","70","0","62","7","6","CONTINUOUS","0","LAYER","2","CARTON","70","0","62","5","6","CONTINUOUS","0","LAYER","2","INNER_BOX","70","0","62","3","6","CONTINUOUS","0","LAYER","2","INNER_BOX_0","70","0","62","30","6","CONTINUOUS","0","LAYER","2","INNER_BOX_90","70","0","62","5","6","CONTINUOUS","0","LAYER","2","FOAM","70","0","62","2","6","CONTINUOUS","0","LAYER","2","TEXT","70","0","62","7","6","CONTINUOUS","0","ENDTAB","0","ENDSEC","0","SECTION","2","ENTITIES",...ents,"0","ENDSEC","0","EOF",""].join("\r\n")
}
function addBox(out,x,y,z,dx,dy,dz){if(Math.min(dx,dy,dz)<=0)return;const p=[[x,y,z],[x+dx,y,z],[x+dx,y+dy,z],[x,y+dy,z],[x,y,z+dz],[x+dx,y,z+dz],[x+dx,y+dy,z+dz],[x,y+dy,z+dz]],f=[[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]];for(const q of f)out.push([p[q[0]],p[q[1]],p[q[2]]],[p[q[0]],p[q[2]],p[q[3]]])}
function stl(data){const {carton:c,layout:l}=data.best,w=Math.max(c.wall,1),[il,iw,ih]=c.inner,[ol,ow,oh]=[il+2*w,iw+2*w,ih+2*w],t=[];addBox(t,0,0,0,ol,ow,w);addBox(t,0,0,w,w,ow,oh-w);addBox(t,ol-w,0,w,w,ow,oh-w);addBox(t,w,0,w,il,w,oh-w);addBox(t,w,ow-w,w,il,w,oh-w);const p=l.padding,xl=p.length.lowStack,xh=p.length.highStack,yl=p.width.lowStack,yh=p.width.highStack,zl=p.height.lowStack,zh=p.height.highStack;addBox(t,w,w,w,xl,iw,ih);addBox(t,w+il-xh,w,w,xh,iw,ih);addBox(t,w,w,w,il,yl,ih);addBox(t,w,w+iw-yh,w,il,yh,ih);addBox(t,w,w,w,il,iw,zl);addBox(t,w,w,w+ih-zh,il,iw,zh);const start=[w+xl+p.length.unfilled/2,w+yl+p.width.unfilled/2,w+zl+p.height.unfilled/2],[dx,dy,dz]=l.orientation,[nx,ny,nz]=l.counts;for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)addBox(t,start[0]+i*dx,start[1]+j*dy,start[2]+k*dz,dx,dy,dz);let out="solid packaging_assembly\n";for(const tri of t){const [a,b,c0]=tri,u=b.map((v,i)=>v-a[i]),v=c0.map((n,i)=>n-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],m=Math.hypot(...n)||1;out+=`  facet normal ${n[0]/m} ${n[1]/m} ${n[2]/m}\n    outer loop\n${tri.map(q=>`      vertex ${q.join(" ")}\n`).join("")}    endloop\n  endfacet\n`}return out+"endsolid packaging_assembly\n"}
function textLines(data){
  const {carton:c,layout:l}=data.best;
  return[
    "包装装箱优化方案",
    `外箱内尺寸：${c.inner.join(" × ")} mm（${c.name}）`,
    `箱型信息：SKU ${c.sku||"-"} / 编码 ${c.code||"-"} / 材质 ${c.material||c.flute}`,
    c.has_existing_foam?`原表配套珍珠棉：${c.foam_note||"有配套珍珠棉备注"}`:"原表配套珍珠棉：无",
    `内盒尺寸：${l.orientation.join(" × ")} mm${l.rotation===90?"（90°长宽互换）":""}`,
    `内盒朝向：${l.orientation.join(" × ")} mm`,
    `排列方式：${l.counts.join(" × ")} = ${l.quantity} 个/箱`,
    `空间利用率：${(l.utilization*100).toFixed(2)}%`
  ];
}
function cartonPrimaryText(c){
  const code=c.code&&c.code!=="*" ? c.code : c.sku||"箱型";
  const outer=Array.isArray(c.outer)?c.outer.join(" × "):"-";
  const material=c.material||c.flute||"-";
  return `${code} ${outer} ${material}`;
}
function layerGridInfo(l){
  const boxes=placedBoxesForLayout(l),round=v=>Math.round(v*1000)/1000;
  const top=boxes.filter(b=>Math.abs(b.z-(boxes[0]?.z||0))<1e-9);
  const unique=values=>new Set(values.map(round)).size;
  return{lengthCount:unique(top.map(b=>b.x)),widthCount:unique(top.map(b=>b.y)),layers:unique(boxes.map(b=>b.z)),perLayer:top.length};
}
function mixedWidthSlices(l){
  const boxes=placedBoxesForLayout(l),round=v=>Math.round(Number(v)*1000)/1000,eps=1e-6;
  const bounds=[...new Set(boxes.flatMap(b=>[round(b.y),round(b.y+b.width)]))].sort((a,b)=>a-b);
  const slices=[];
  for(let i=0;i<bounds.length-1;i++){
    const start=bounds[i],end=bounds[i+1];
    if(end-start<=eps)continue;
    const sliceBoxes=boxes.filter(b=>round(b.y)<end-eps&&round(b.y+b.width)>start+eps)
      .sort((a,b)=>a.z-b.z||a.x-b.x||a.rotation-b.rotation);
    if(sliceBoxes.length)slices.push({index:slices.length,start,end,boxes:sliceBoxes});
  }
  return slices;
}
function mixedBoxLayer(box){return box.rotation===90?"INNER_BOX_90":"INNER_BOX_0"}
function mixedBoxCanvasStyle(box){
  return box.rotation===90
    ?{fill:"rgba(106,126,235,.46)",stroke:"#223fae"}
    :{fill:"rgba(242,153,74,.48)",stroke:"#9c4d13"};
}
function visibleSideCells(boxes,totalWidth,totalHeight,project,depthOf,preferMax){
  const eps=1e-6,round=v=>Math.round(Number(v)*1000)/1000;
  const projected=boxes.map(box=>({box,depth:depthOf(box),...project(box)}))
    .filter(r=>r.w>eps&&r.h>eps);
  const xs=[0,totalWidth],zs=[0,totalHeight];
  projected.forEach(r=>{xs.push(Math.max(0,round(r.x)),Math.min(totalWidth,round(r.x+r.w)));zs.push(Math.max(0,round(r.z)),Math.min(totalHeight,round(r.z+r.h)))});
  const xBounds=[...new Set(xs.map(round))].sort((a,b)=>a-b),zBounds=[...new Set(zs.map(round))].sort((a,b)=>a-b),cells=[];
  for(let xi=0;xi<xBounds.length-1;xi++)for(let zi=0;zi<zBounds.length-1;zi++){
    const x=xBounds[xi],x2=xBounds[xi+1],z=zBounds[zi],z2=zBounds[zi+1];
    if(x2-x<=eps||z2-z<=eps)continue;
    const cx=(x+x2)/2,cz=(z+z2)/2;
    const hits=projected.filter(r=>cx>r.x+eps&&cx<r.x+r.w-eps&&cz>r.z+eps&&cz<r.z+r.h-eps);
    if(!hits.length)continue;
    hits.sort((a,b)=>preferMax?b.depth-a.depth:a.depth-b.depth);
    cells.push({x,z,w:x2-x,h:z2-z,box:hits[0].box});
  }
  return mergeVisibleCells(cells);
}
function mergeVisibleCells(cells){
  const eps=1e-6,sameBox=(a,b)=>a.box.index===b.box.index&&a.box.rotation===b.box.rotation,near=(a,b)=>Math.abs(a-b)<eps;
  let list=cells.map(c=>({...c})),changed=true;
  while(changed){
    changed=false;
    outer:for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
      const a=list[i],b=list[j];
      if(sameBox(a,b)&&near(a.z,b.z)&&near(a.h,b.h)&&(near(a.x+a.w,b.x)||near(b.x+b.w,a.x))){
        const x=Math.min(a.x,b.x),right=Math.max(a.x+a.w,b.x+b.w);
        list.splice(j,1);list.splice(i,1,{...a,x,w:right-x});changed=true;break outer;
      }
      if(sameBox(a,b)&&near(a.x,b.x)&&near(a.w,b.w)&&(near(a.z+a.h,b.z)||near(b.z+b.h,a.z))){
        const z=Math.min(a.z,b.z),top=Math.max(a.z+a.h,b.z+b.h);
        list.splice(j,1);list.splice(i,1,{...a,z,h:top-z});changed=true;break outer;
      }
    }
  }
  return list.sort((a,b)=>a.z-b.z||a.x-b.x);
}
function mixedSideViews(l,c,p){
  const [cl,cw,ch]=c.inner;
  const offX=p.length.lowStack+p.length.unfilled/2,offY=p.width.lowStack+p.width.unfilled/2,offZ=p.height.lowStack+p.height.unfilled/2;
  const boxes=placedBoxesForLayout(l).map(b=>({...b,x:b.x+offX,y:b.y+offY,z:b.z+offZ}));
  return[
    {key:"A",title:"侧面 A",width:cl,height:ch,cells:visibleSideCells(boxes,cl,ch,b=>({x:cl-(b.x+b.length),z:b.z,w:b.length,h:b.height}),b=>b.y,false)},
    {key:"B",title:"侧面 B",width:cw,height:ch,cells:visibleSideCells(boxes,cw,ch,b=>({x:cw-(b.y+b.width),z:b.z,w:b.width,h:b.height}),b=>b.x+b.length,true)},
    {key:"C",title:"侧面 C",width:cl,height:ch,cells:visibleSideCells(boxes,cl,ch,b=>({x:b.x,z:b.z,w:b.length,h:b.height}),b=>b.y+b.width,true)},
    {key:"D",title:"侧面 D",width:cw,height:ch,cells:visibleSideCells(boxes,cw,ch,b=>({x:b.y,z:b.z,w:b.width,h:b.height}),b=>b.x,false)}
  ];
}
function pdfLine(text,bold=false){return{text,bold}}
function pdfTextLines(data){
  const {carton:c,layout:l}=data.best,d=l.orientationDistribution||{rotation0:0,rotation90:0};
  const grid=layerGridInfo(l),hasMixed=d.rotation0>0&&d.rotation90>0;
  const lines=[
    pdfLine("包装装箱优化方案"),
    pdfLine(`外箱：${cartonPrimaryText(c)}（内尺寸 ${c.inner.join(" × ")} mm）`,true),
    pdfLine(`箱型信息：SKU ${c.sku||"-"} / 编码 ${c.code||"-"} / 材质 ${c.material||c.flute}`),
    pdfLine(c.has_existing_foam?`原表配套珍珠棉：${c.foam_note||"有配套珍珠棉备注"}`:"原表配套珍珠棉：无"),
    pdfLine(`内盒尺寸：${l.orientation.join(" × ")} mm${l.rotation===90?"（90°长宽互换）":""}`)
  ];
  if(hasMixed){
    lines.push(
      pdfLine("装箱模式：平放长宽混排",true),
      pdfLine(`朝向分布：0° ${d.rotation0} 个，90° ${d.rotation90} 个`,true),
      pdfLine(`装箱数量：每层 ${grid.perLayer} 个 × ${grid.layers} 层 = ${l.quantity} 个/箱`,true)
    );
  }else{
    const rotation=d.rotation90>0?"90°":"0°";
    lines.push(
      pdfLine(`装箱模式：统一朝向平放（${rotation}${l.rotation===90?"，长宽互换":""}）`,true),
      pdfLine(`排列方式：长方向 ${grid.lengthCount} × 宽方向 ${grid.widthCount} × 高方向 ${grid.layers} = ${l.quantity} 个/箱`,true)
    );
  }
  lines.push(pdfLine(`空间利用率：${(l.utilization*100).toFixed(2)}%；底面积利用率：${((l.areaUtilization||0)*100).toFixed(2)}%`));
  return lines;
}
function drawMixedDrawing(ctx,data,x,y,w,h){
  const {carton:c,layout:l}=data.best,p=l.padding,[cl,cw,ch]=c.inner,boxes=placedBoxesForLayout(l),topBoxes=boxes.filter(b=>Math.abs(b.z)<1e-9);
  const topScale=Math.min((w*.54)/cl,(h*.34)/cw);
  const ox=x+18,oy=y+66,legendX=x+w*.62,legendW=x+w-legendX-18;
  const offsetX=p.length.lowStack+p.length.unfilled/2,offsetY=p.width.lowStack+p.width.unfilled/2,offsetZ=p.height.lowStack+p.height.unfilled/2;
  const hasMixed=isTrueMixedFlat(l),sideViews=hasMixed?mixedSideViews(l,c,p):mixedSideViews(l,c,p).slice(0,1);
  ctx.save();
  ctx.strokeStyle="#1f3c56";ctx.lineWidth=2;ctx.fillStyle="#1f3c56";ctx.font='22px "Microsoft YaHei",sans-serif';
  ctx.fillText("DXF/PDF 对应图纸预览",x+20,y+28);
  const rect=(rx,ry,rw,rh,fill,stroke="#1f3c56")=>{if(fill){ctx.fillStyle=fill;ctx.fillRect(rx,ry,rw,rh)}ctx.strokeStyle=stroke;ctx.strokeRect(rx,ry,rw,rh)};
  const drawBox=(b,rx,ry,rw,rh)=>{
    const style=mixedBoxCanvasStyle(b);
    rect(rx,ry,rw,rh,style.fill,style.stroke);
  };
  ctx.font='16px "Microsoft YaHei",sans-serif';ctx.fillStyle="#1f3c56";ctx.fillText("俯视图",ox,oy-12);
  rect(ox,oy,cl*topScale,cw*topScale,null);
  if(p.length.lowStack)rect(ox,oy,p.length.lowStack*topScale,cw*topScale,"rgba(46,139,111,.24)","#2e8b6f");
  if(p.length.highStack)rect(ox+(cl-p.length.highStack)*topScale,oy,p.length.highStack*topScale,cw*topScale,"rgba(46,139,111,.24)","#2e8b6f");
  if(p.width.lowStack)rect(ox,oy,cl*topScale,p.width.lowStack*topScale,"rgba(46,139,111,.18)","#2e8b6f");
  if(p.width.highStack)rect(ox,oy+(cw-p.width.highStack)*topScale,cl*topScale,p.width.highStack*topScale,"rgba(46,139,111,.18)","#2e8b6f");
  for(const b of topBoxes)drawBox(b,ox+(offsetX+b.x)*topScale,oy+(offsetY+b.y)*topScale,b.length*topScale,b.width*topScale);
  if(hasMixed){

  ctx.fillStyle="#1f3c56";ctx.font='16px "Microsoft YaHei",sans-serif';ctx.fillText("四个外侧面（A/B/C/D）",ox,y+h*.47);
  const sideX=ox,sideY=y+h*.50,sideW=w*.56,sideH=h*.43;
  const cols=2,rows=2,gap=14;
  const cellW=(sideW-gap*(cols-1))/cols,cellH=(sideH-gap*(rows-1))/rows;
  sideViews.forEach((view,i)=>{
    const col=i%cols,row=Math.floor(i/cols),cx=sideX+col*(cellW+gap),cy=sideY+row*(cellH+gap),viewY=cy+20;
    const sideScale=Math.min((cellW-18)/view.width,(cellH-42)/view.height);
    ctx.fillStyle="#51697d";ctx.font='12px "Microsoft YaHei",sans-serif';
    ctx.fillText(view.title,cx,cy+10);
    rect(cx,viewY,view.width*sideScale,view.height*sideScale,null);
    for(const cell of view.cells){
      drawBox(cell.box,cx+cell.x*sideScale,viewY+(view.height-cell.z-cell.h)*sideScale,cell.w*sideScale,cell.h*sideScale);
    }
  });
  }else{
    const view=sideViews[0],sideX=ox,sideY=y+h*.52,sideW=w*.44,sideH=h*.36,sideScale=Math.min(sideW/view.width,sideH/view.height);
    ctx.fillStyle="#1f3c56";ctx.font='16px "Microsoft YaHei",sans-serif';ctx.fillText("\u4fa7\u89c6\u56fe",sideX,sideY-12);
    rect(sideX,sideY,view.width*sideScale,view.height*sideScale,null);
    for(const cell of view.cells){
      drawBox(cell.box,sideX+cell.x*sideScale,sideY+(view.height-cell.z-cell.h)*sideScale,cell.w*sideScale,cell.h*sideScale);
    }
  }
  const legend=(title,lines,ly)=>{
    ctx.fillStyle="#ffffff";ctx.strokeStyle="#d7dee3";ctx.fillRect(legendX-14,ly-30,legendW+20,112);ctx.strokeRect(legendX-14,ly-30,legendW+20,112);
    ctx.fillStyle="#17324d";ctx.font='700 22px "Microsoft YaHei",sans-serif';ctx.fillText(title,legendX,ly);
    ctx.fillStyle="#34495e";ctx.font='18px "Microsoft YaHei",sans-serif';
    lines.forEach((line,i)=>wrapCanvasText(ctx,line,legendX,ly+30+i*24,legendW,22));
  };
  legend("左/右珍珠棉",[`${p.length.low} / ${p.length.high} 片`,`${foamSpec(c,"length").code}`,`${foamSpec(c,"length").size} mm`],oy+8);
  legend("前/后珍珠棉",[`${p.width.low} / ${p.width.high} 片`,`${foamSpec(c,"width").code}`,`${foamSpec(c,"width").size} mm`],oy+146);
  legend("下/上珍珠棉",[`${p.height.low} / ${p.height.high} 片`,`${foamSpec(c,"height").code}`,`${foamSpec(c,"height").size} mm`],y+h*.56);
  ctx.restore();
}
function drawDrawing(ctx,data,x,y,w,h){
  if(data.best.layout.mode==="mixedOrientationFlat")return drawMixedDrawing(ctx,data,x,y,w,h);
  const {carton:c,layout:l}=data.best,p=l.padding,[cl,cw,ch]=c.inner,[bl,bw,bh]=l.orientation,[nl,nw,nh]=l.counts;
  const scale=Math.min((w*.50)/cl,(h*.46)/cw,(h*.36)/ch),ox=x+20,oy=y+55,sy=y+h*.58;
  ctx.save();ctx.strokeStyle="#1f3c56";ctx.lineWidth=2;ctx.fillStyle="#1f3c56";ctx.font='22px "Microsoft YaHei",sans-serif';ctx.fillText("DXF/PDF 对应图纸预览",x+20,y+28);
  const rect=(rx,ry,rw,rh,fill)=>{if(fill){ctx.fillStyle=fill;ctx.fillRect(rx,ry,rw,rh)}ctx.strokeRect(rx,ry,rw,rh)};
  const legendX=x+w*.58,legendW=x+w-legendX-18;
  const drawLegend=(title,spec,countText,ly)=>{
    ctx.fillStyle="#17324d";ctx.font='700 24px "Microsoft YaHei",sans-serif';ctx.fillText(title,legendX,ly);
    ctx.fillStyle="#34495e";ctx.font='21px "Microsoft YaHei",sans-serif';
    ctx.fillText(`片数：${countText}`,legendX,ly+34);
    wrapCanvasText(ctx,`SKU：${spec.code}`,legendX,ly+66,legendW,29);
    wrapCanvasText(ctx,`尺寸：${spec.size} mm`,legendX,ly+96,legendW,29);
  };
  ctx.font='16px "Microsoft YaHei",sans-serif';ctx.fillStyle="#1f3c56";ctx.fillText("俯视图",ox,oy-12);rect(ox,oy,cl*scale,cw*scale,null);
  const x0=ox+(p.length.lowStack+p.length.unfilled/2)*scale,y0=oy+(p.width.lowStack+p.width.unfilled/2)*scale;
  ctx.fillStyle="rgba(46,139,111,.32)";if(p.length.lowStack)rect(ox,oy,p.length.lowStack*scale,cw*scale,"rgba(46,139,111,.32)");if(p.length.highStack)rect(ox+(cl-p.length.highStack)*scale,oy,p.length.highStack*scale,cw*scale,"rgba(46,139,111,.32)");if(p.width.lowStack)rect(ox,oy,cl*scale,p.width.lowStack*scale,"rgba(46,139,111,.25)");if(p.width.highStack)rect(ox,oy+(cw-p.width.highStack)*scale,cl*scale,p.width.highStack*scale,"rgba(46,139,111,.25)");
  for(let j=0;j<nw;j++)for(let i=0;i<nl;i++)rect(x0+i*bl*scale,y0+j*bw*scale,bl*scale,bw*scale,"rgba(242,153,74,.42)");
  drawLegend("左/右珍珠棉",foamSpec(c,"length"),`左 ${p.length.low} / 右 ${p.length.high}`,oy+8);
  drawLegend("前/后珍珠棉",foamSpec(c,"width"),`前 ${p.width.low} / 后 ${p.width.high}`,oy+146);
  ctx.fillText("侧视图",ox,sy-12);rect(ox,sy,cl*scale,ch*scale,null);const sx0=ox+(p.length.lowStack+p.length.unfilled/2)*scale,sz0=sy+(p.height.lowStack+p.height.unfilled/2)*scale;
  if(p.height.lowStack)rect(ox,sy,cl*scale,p.height.lowStack*scale,"rgba(46,139,111,.25)");if(p.height.highStack)rect(ox,sy+(ch-p.height.highStack)*scale,cl*scale,p.height.highStack*scale,"rgba(46,139,111,.25)");
  for(let k=0;k<nh;k++)for(let i=0;i<nl;i++)rect(sx0+i*bl*scale,sz0+k*bh*scale,bl*scale,bh*scale,"rgba(242,153,74,.42)");
  drawLegend("下/上珍珠棉",foamSpec(c,"height"),`下 ${p.height.low} / 上 ${p.height.high}`,sy+8);
  ctx.restore();
}
function wrapCanvasText(ctx,text,x,y,maxWidth,lineHeight){
  let line="";
  for(const char of text){
    const test=line+char;
    if(ctx.measureText(test).width>maxWidth&&line){ctx.fillText(line,x,y);line=char;y+=lineHeight}else line=test;
  }
  if(line)ctx.fillText(line,x,y);
  return y+lineHeight;
}
function drawPdfPage(ctx,data){
  const canvas=ctx.canvas;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle="#f4f7fb";ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle="#17324d";ctx.fillRect(0,0,canvas.width,190);
  ctx.fillStyle="#ffffff";ctx.font='700 58px "Microsoft YaHei","Noto Sans CJK SC",sans-serif';ctx.fillText("包装装箱优化方案",72,105);
  ctx.font='24px "Microsoft YaHei","Noto Sans CJK SC",sans-serif';ctx.fillStyle="#cfe3ec";ctx.fillText("PACKAGING GRID REPORT · 单位 mm",75,153);
  drawDrawing(ctx,data,70,220,1100,700);
  const lines=pdfTextLines(data);let y=980;
  for(let i=1;i<lines.length;i++){
    const line=typeof lines[i]==="string"?pdfLine(lines[i],false):lines[i];
    ctx.fillStyle=line.bold?"#17324d":"#263d50";
    ctx.font=line.bold?'700 30px "Microsoft YaHei","Noto Sans CJK SC",sans-serif':'30px "Microsoft YaHei","Noto Sans CJK SC",sans-serif';
    y=wrapCanvasText(ctx,line.text,78,y,1080,48);
    if(i===lines.length-2){ctx.strokeStyle="#cbd6dd";ctx.beginPath();ctx.moveTo(78,y);ctx.lineTo(1162,y);ctx.stroke();y+=28}
  }
}
function renderPdfPreview(data){
  const canvas=$("pdfPreviewCanvas"),ctx=canvas?.getContext("2d");
  if(ctx)drawPdfPage(ctx,data);
}
function canvasToBlob(canvas,type,quality){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("无法生成PDF页面")),type,quality))}
function excelCell(value){return String(value??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function selectedColorBoxRow(){
  const box=window.selectedCommonInnerBox;
  if(!box||!Array.isArray(box.outer))return null;
  return{type:"彩盒",sku:box.sku||box.code||"",name:box.name||"通用飞机盒",size:box.outer.join("×"),qty:1,base:1,unit:"个",note:[box.code&&box.code!=="*" ? `编码 ${box.code}`:"",box.material?`材质 ${box.material}`:"",box.logo,box.note].filter(Boolean).join("；")};
}
function excelBomRows(data){
  const {carton:c,layout:l}=data.best,p=l.padding,base=l.quantity,rows=[
    {type:"纸箱",sku:c.sku||c.code||"",name:c.name||"包装箱",size:Array.isArray(c.outer)?c.outer.join("×"):"",qty:1,base,unit:"个",note:`内尺寸 ${c.inner.join("×")} mm`}
  ];
  const colorBox=selectedColorBoxRow();
  if(colorBox)rows.unshift(colorBox);
  const foamRows=new Map();
  for(const axis of PADDING_AXES){
    const spec=foamSpec(c,axis);
    if(!spec.code||spec.code==="-")continue;
    const count=Number(p[axis]?.sheets)||0;
    const existing=foamRows.get(spec.code)||{type:"珍珠棉",sku:spec.code,name:spec.face,size:spec.size,qty:0,base,unit:"片",note:[]};
    existing.qty+=count;
    existing.note.push(`${spec.face} ${count}片`);
    if(existing.size==="-"&&spec.size!=="-")existing.size=spec.size;
    foamRows.set(spec.code,existing);
  }
  return rows.concat([...foamRows.values()]
    .filter(row=>row.qty>0)
    .map(row=>({...row,note:row.note.join("；")})));
}
function excelTable(data){
  const {carton:c,layout:l}=data.best,rows=excelBomRows(data),headers=["物料类型","SKU","名称/方向","规格(mm)","数量","底数","单位","备注"];
  const summary=[
    ["外箱",`${c.sku||"-"} ${Array.isArray(c.outer)?c.outer.join("×"):"-"} ${c.material||c.flute||""}`],
    ["内盒尺寸",`${l.orientation.join("×")} mm${l.rotation===90?"（90°长宽互换）":""}`],
    ["装箱数量",`${l.quantity} 个/箱`],
    ["排列方式",`${modeText(l)}；${planLayoutSummary(l)}个`],
    ["朝向分布",orientationSummary(l)]
  ];
  const tr=cells=>`<tr>${cells.map(v=>`<td>${excelCell(v)}</td>`).join("")}</tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    table{border-collapse:collapse;font-family:"Microsoft YaHei",Arial,sans-serif;font-size:12px}
    th,td{border:1px solid #9fb0bf;padding:6px 8px;white-space:nowrap}
    th{background:#17324d;color:#fff;font-weight:700}
    .title{font-size:18px;font-weight:700;background:#e9f0f6;color:#17324d}
  </style></head><body><table>
    <tr><td class="title" colspan="8">包装装箱物料清单</td></tr>
    ${summary.map(([k,v])=>`<tr><td colspan="2">${excelCell(k)}</td><td colspan="6">${excelCell(v)}</td></tr>`).join("")}
    <tr>${headers.map(h=>`<th>${excelCell(h)}</th>`).join("")}</tr>
    ${rows.map(row=>tr([row.type,row.sku,row.name,row.size,row.qty,row.base,row.unit,row.note])).join("")}
  </table></body></html>`;
}
function excelBlob(data){return new Blob(["\ufeff",excelTable(data)],{type:"application/vnd.ms-excel;charset=utf-8"})}
function concatBytes(parts){
  const size=parts.reduce((sum,part)=>sum+part.length,0),out=new Uint8Array(size);let offset=0;
  for(const part of parts){out.set(part,offset);offset+=part.length}
  return out;
}
async function pdfBlob(data){
  const canvas=document.createElement("canvas");canvas.width=1240;canvas.height=1754;
  const ctx=canvas.getContext("2d");
  drawPdfPage(ctx,data);
  const jpegBlob=await canvasToBlob(canvas,"image/jpeg",.92),jpeg=new Uint8Array(await jpegBlob.arrayBuffer()),enc=new TextEncoder();
  const chunks=[];let offset=0;const offsets=[0];
  const push=bytes=>{chunks.push(bytes);offset+=bytes.length};
  const text=value=>enc.encode(value);
  push(new Uint8Array([37,80,68,70,45,49,46,52,10,37,255,255,255,255,10]));
  const object=(id,parts)=>{offsets[id]=offset;push(text(`${id} 0 obj\n`));for(const part of parts)push(typeof part==="string"?text(part):part);push(text("\nendobj\n"))};
  object(1,["<< /Type /Catalog /Pages 2 0 R >>"]);
  object(2,["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  object(3,["<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"]);
  object(4,[`<< /Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,jpeg,"\nendstream"]);
  const content=text("q 595 0 0 842 0 0 cm /Im0 Do Q");
  object(5,[`<< /Length ${content.length} >>\nstream\n`,content,"\nendstream"]);
  const xref=offset;push(text("xref\n0 6\n0000000000 65535 f \n"));
  for(let i=1;i<=5;i++)push(text(String(offsets[i]).padStart(10,"0")+" 00000 n \n"));
  push(text(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return new Blob([concatBytes(chunks)],{type:"application/pdf"});
}
function revokeExports(){for(const url of exportUrls)URL.revokeObjectURL(url);exportUrls=[]}
function setExport(kind,name,blob){
  const link=document.querySelector(`[data-download="${kind}"]`),url=URL.createObjectURL(blob);exportUrls.push(url);
  link.href=url;link.download=name;link.target="_blank";link.setAttribute("aria-disabled","false");
}
async function prepareExports(data){
  const generation=++exportGeneration;revokeExports();
  document.querySelectorAll("[data-download]").forEach(link=>{link.href="#";link.removeAttribute("download");link.setAttribute("aria-disabled","true")});
  $("exportStatus").textContent="正在准备导出文件…";
  setExport("excel","packaging-bom.xls",excelBlob(data));
  setExport("json","result.json",new Blob([JSON.stringify(serializable(data),null,2)],{type:"application/json;charset=utf-8"}));
  setExport("report","packaging-report.md",new Blob([report(data)],{type:"text/markdown;charset=utf-8"}));
  setExport("dxf","layout-drawing.dxf",new Blob([dxf(data)],{type:"application/dxf;charset=utf-8"}));
  try{
    const pdf=await pdfBlob(data);if(generation!==exportGeneration)return;
    setExport("pdf","packaging-plan.pdf",pdf);$("exportStatus").textContent="全部文件已准备好，点击按钮即可下载。";
  }catch(error){$("exportStatus").textContent=`其他文件已就绪；PDF生成失败：${error.message}`}
}
function serializable(data){return{schema_version:"1.0",mode:data.mode,inner_box:{dimensions_mm:data.box.dims,weight_kg:data.box.weight},options:data.opt,best:{carton:data.best.carton,layout:data.best.layout,ergonomics:data.best.ergonomics},alternatives:data.alternatives,comparison_plans:data.comparisonPlans}}
function parseDimsText(text){const m=String(text||"").match(/\d+(?:\.\d+)?/g)||[];return m.length>=3?m.slice(0,3).map(Number):null}
function previewFoamDims(c,axis,sku){
  const rec=foamAxisRecord(c,axis);
  if(rec&&Array.isArray(rec.dimensions_mm))return rec.dimensions_mm.slice(0,3).map(Number);
  return parseDimsText(foamAxisSize(c,axis,sku)||foamSkuSize(sku));
}
function buildPreviewFoams(data){
  const c=data.best.carton,p=data.best.layout.padding;
  const item=(key,axis,pairLabel,count,countText)=>{
    const sku=foamAxisRecord(c,axis)?.sku||foamCodes(c)[axis]||"";
    const dims=previewFoamDims(c,axis,sku);
    return{key,axis,pairLabel,count,countText,sku,dims,dimensionText:foamAxisSize(c,axis,sku)};
  };
  return[
    item("top","height","上/下",+p.height.high||0,`下${p.height.low}片 / 上${p.height.high}片`),
    item("bottom","height","上/下",+p.height.low||0,`下${p.height.low}片 / 上${p.height.high}片`),
    item("left","length","左/右",+p.length.low||0,`左${p.length.low}片 / 右${p.length.high}片`),
    item("right","length","左/右",+p.length.high||0,`左${p.length.low}片 / 右${p.length.high}片`),
    item("front","width","前/后",+p.width.low||0,`前${p.width.low}片 / 后${p.width.high}片`),
    item("back","width","前/后",+p.width.high||0,`前${p.width.low}片 / 后${p.width.high}片`)
  ];
}
function withPreviewFoams(data){return{...data,previewFoams:buildPreviewFoams(data)}}
function renderEngineeringPreview(previewData){
  const mount=$("preview");
  if(window.renderPacking3D){window.renderPacking3D(previewData,mount);return}
  mount.classList.remove("preview-3d");
  mount.innerHTML=svgPreviewV4(previewData);
  clearTimeout(preview3dRetryTimer);
  let attempts=0;
  const retry=()=>{
    if(!current)return;
    if(window.renderPacking3D){window.renderPacking3D(current,mount);return}
    if(++attempts<20)preview3dRetryTimer=setTimeout(retry,250);
  };
  preview3dRetryTimer=setTimeout(retry,250);
}
function isTrueMixedFlat(l){const d=l.orientationDistribution||{rotation0:0,rotation90:0};return l.mode==="mixedOrientationFlat"&&Number(d.rotation0)>0&&Number(d.rotation90)>0}
function modeText(l){return isTrueMixedFlat(l)?"平放混排":"统一朝向平放"}
function orientationSummary(l){const d=l.orientationDistribution||{rotation0:0,rotation90:0};return `0° ${d.rotation0} / 90° ${d.rotation90}`}
function displayGridCounts(l){const boxes=Array.isArray(l.boxes)?l.boxes:[];if(!boxes.length)return l.counts;const uniqueCount=key=>new Set(boxes.map(box=>Math.round(Number(box[key])*1000)/1000)).size;return[uniqueCount("x"),uniqueCount("y"),uniqueCount("z")]}
function layoutSummary(l){return isTrueMixedFlat(l)?`每层 ${l.counts[0]} × ${l.counts[2]}层 = ${l.quantity}`:`${displayGridCounts(l).join("×")}=${l.quantity}`}
function planLayoutSummary(l){const counts=displayGridCounts(l);return isTrueMixedFlat(l)?layoutSummary(l):`长方向 ${counts[0]} × 宽方向 ${counts[1]} × 高方向 ${counts[2]} = ${l.quantity}`}
function paddingModeAxis(l){return isTrueMixedFlat(l)?"混排":"装箱方式"}
function evaluationSummary(l){const e=l.evaluation;if(!e)return"";const gapPart=isTrueMixedFlat(l)?`${e.gap.message} · `:"";return`${gapPart}${e.clearanceStatus.message}`}
function evaluationTags(l){return(l.evaluation?.tags||[]).map(tag=>`<b class="plan-tag">${esc(tag)}</b>`).join("")}
function paddingPackingSummary(l){
  const base=`底面积利用率 ${((l.areaUtilization||0)*100).toFixed(2)}%`;
  const evalText=l.evaluation?` · 最小方向余量 ${l.evaluation.clearance.minAxis}mm${isTrueMixedFlat(l)?` · 内部缺口 ${(l.evaluation.footprint.internalGapRatio*100).toFixed(1)}%`:""}`:"";
  if(isTrueMixedFlat(l))return`${base} · ${orientationSummary(l)} · 较统一 ${l.improvement>0?`+${l.improvement}`:l.improvement||0}个${evalText}`;
  const counts=displayGridCounts(l);return`${base} · 统一朝向平放 ${l.quantity}个 长${counts[0]}*宽${counts[1]}*高${counts[2]}${evalText}`
}
function planCard(item,i,selectedKey){const c=item.carton,l=item.layout,e=item.ergonomics,foam=c.has_existing_foam?"配套珍珠棉":"无原表棉",risk=e.passed?"人体工学通过":"超建议需确认",improve=l.improvement>0?` · 较统一 +${l.improvement}`:"",tags=evaluationTags(l),tagLine=tags?`<span class="plan-card-tags">${tags}</span>`:"";return`<button class="plan-card ${planKey(item)===selectedKey?"selected":""}" data-plan="${i}"><strong>${i+1}. ${esc(c.code&&c.code!=="*" ? c.code : c.sku||"箱型")} · ${modeText(l)} · ${planLayoutSummary(l)}个</strong><span>${esc(c.name)} · 内尺寸 ${c.inner.join("×")} mm</span>${tagLine}<em>体积 ${(l.utilization*100).toFixed(2)}% · 底面 ${((l.areaUtilization||0)*100).toFixed(2)}% · ${orientationSummary(l)} · 余量 ${l.residual.join("×")}mm${improve} · ${evaluationSummary(l)} · ${foam} · ${risk}</em></button>`}
function renderPlanList(previewData,selectedKey){
  const plans=previewData.comparisonPlans;
  const selectedIndex=plans.findIndex(item=>planKey(item)===selectedKey);
  const visibleIndexes=plansExpanded
    ?plans.map((_,index)=>index)
    :[...new Set([0,1,2,selectedIndex].filter(index=>index>=0&&index<plans.length))].sort((a,b)=>a-b);
  $("planList").innerHTML=visibleIndexes.map(index=>planCard(plans[index],index,selectedKey)).join("");
  $("planList").querySelectorAll("[data-plan]").forEach(btn=>btn.addEventListener("click",()=>{
    const idx=Number(btn.dataset.plan),chosen=plans[idx];
    render({...previewData,best:chosen,alternatives:plans.filter((_,j)=>j!==idx).slice(0,3)});
    prepareExports(current);
  }));
  const disclosure=$("planDisclosure"),hiddenCount=plans.length-visibleIndexes.length;
  disclosure.hidden=plans.length<=3;
  disclosure.setAttribute("aria-expanded",String(plansExpanded));
  disclosure.querySelector("span").textContent=plansExpanded?"收起其余方案":`展开其余 ${hiddenCount} 个方案`;
}
function render(data,resetPlanDisclosure=false){
  if(resetPlanDisclosure)plansExpanded=false;
  const previewData=withPreviewFoams(data);current=previewData;
  const {carton:c,layout:l}=previewData.best,p=l.padding,selectedKey=planKey(previewData.best);
  $("results").hidden=false;
  $("countGrid").textContent=layoutSummary(l);$("quantity").textContent=l.quantity;
  $("orientationText").textContent=`${modeText(l)} · ${orientationSummary(l)} · ${c.name}`;
  $("utilization").textContent=`${(l.utilization*100).toFixed(2)}%`;
  $("totalWeight").textContent=`${l.totalWeight.toFixed(2)} kg${previewData.best.ergonomics&&!previewData.best.ergonomics.passed?" · 超建议":""}`;
  $("foamTotal").textContent=`${l.foamTotal} 片`;
  renderEngineeringPreview(previewData);
  renderPdfPreview(previewData);
  $("paddingTable").innerHTML=[["长方向",p.length,"左","右",codeText(c,"length")],["宽方向",p.width,"前","后",codeText(c,"width")],["高方向",p.height,"下","上",codeText(c,"height")],[paddingModeAxis(l),null,"","",paddingPackingSummary(l)]].map(([axis,x,a,b,code])=>x?`<div class="padding-row"><strong>${axis}</strong><span>余量 ${x.margin}mm · ${a}${x.low}片 / ${b}${x.high}片 ${code}</span><em>未填 ${x.unfilled}mm</em></div>`:`<div class="padding-row"><strong>${axis}</strong><span>${code}</span><em>${modeText(l)}</em></div>`).join("");
  renderPlanList(previewData,selectedKey);
  $("results").scrollIntoView({behavior:"smooth",block:"start"});
}
["innerL","innerW","innerH"].forEach(id=>$(id).addEventListener("input",event=>{
  renderInnerBoxGuide();
  if(event.isTrusted&&!window.applyingCommonInnerBox)window.selectedCommonInnerBox=null;
}));
$("cartonFields").hidden=$("autoMode").checked;
$("autoMode").addEventListener("change",()=>$("cartonFields").hidden=$("autoMode").checked);
$("calculate").addEventListener("click",()=>{try{$("error").textContent="";render(collect(),true)}catch(e){$("error").textContent=e.message}});
$("calculate").addEventListener("click",()=>{if(current&&!$("error").textContent)prepareExports(current)});
$("planDisclosure").addEventListener("click",()=>{plansExpanded=!plansExpanded;if(current)renderPlanList(current,planKey(current.best))});
window.addEventListener("packing3d-ready",()=>{if(current)renderEngineeringPreview(current)});
$("pdfPreviewToggle").addEventListener("click",()=>{
  const expanded=$("pdfPreviewToggle").getAttribute("aria-expanded")==="true";
  $("pdfPreviewToggle").setAttribute("aria-expanded",String(!expanded));
  $("pdfPreviewToggle").querySelector(".disclosure-label").textContent=expanded?"展开":"收起";
  $("pdfPreviewBody").hidden=expanded;
});
document.querySelectorAll("[data-download]").forEach(link=>link.addEventListener("click",event=>{
  if(link.getAttribute("aria-disabled")==="true"){event.preventDefault();return}
  $("exportStatus").textContent=`已触发 ${link.textContent.trim()} 下载；如果浏览器打开预览页，请使用“保存”或“下载”。`;
}));
document.querySelectorAll('input').forEach(input=>input.setAttribute('autocomplete','off'));
window.addEventListener("beforeunload",revokeExports);
renderInnerBoxGuide();
if("serviceWorker" in navigator&&location.protocol.startsWith("http")){
  const localPreview=location.hostname==="127.0.0.1"||location.hostname==="localhost";
  if(localPreview){
    navigator.serviceWorker.getRegistrations().then(registrations=>registrations.forEach(registration=>registration.unregister())).catch(()=>{});
    if("caches" in window)caches.keys().then(keys=>keys.forEach(key=>caches.delete(key))).catch(()=>{});
  }else navigator.serviceWorker.register("./sw.js").catch(()=>{});
}
