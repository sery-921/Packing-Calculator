"use strict";

(function(root){
  const EPS=1e-9;
  const pct=value=>Math.max(0,value||0);
  const round=value=>Math.round((Number(value)||0)*1000)/1000;
  const product=values=>values.reduce((a,b)=>a*b,1);

  function layerBoxes(boxes){
    if(!Array.isArray(boxes)||!boxes.length)return[];
    const z=Math.min(...boxes.map(box=>Number(box.z)||0));
    return boxes.filter(box=>Math.abs((Number(box.z)||0)-z)<EPS);
  }

  function extents(boxes){
    if(!Array.isArray(boxes)||!boxes.length)return{length:0,width:0,height:0};
    return{
      length:Math.max(...boxes.map(box=>(Number(box.x)||0)+(Number(box.length)||0))),
      width:Math.max(...boxes.map(box=>(Number(box.y)||0)+(Number(box.width)||0))),
      height:Math.max(...boxes.map(box=>(Number(box.z)||0)+(Number(box.height)||0)))
    };
  }

  function footprintMetrics(layout,carton,box){
    const boxes=layerBoxes(layout.boxes);
    const cartonArea=product(carton.inner.slice(0,2));
    const usedArea=boxes.length
      ?boxes.reduce((sum,item)=>sum+(Number(item.length)||0)*(Number(item.width)||0),0)
      :(layout.counts?.[0]||0)*(layout.counts?.[1]||0)*(layout.orientation?.[0]||box.dims[0])*(layout.orientation?.[1]||box.dims[1]);
    const bounds=extents(boxes);
    const boundingArea=boxes.length?bounds.length*bounds.width:usedArea;
    const internalGapArea=Math.max(0,boundingArea-usedArea);
    const internalGapRatio=cartonArea?internalGapArea/cartonArea:0;
    const areaUtilization=cartonArea?usedArea/cartonArea:(layout.areaUtilization||0);
    return{
      usedArea:round(usedArea),
      boundingArea:round(boundingArea),
      internalGapArea:round(internalGapArea),
      internalGapRatio,
      areaUtilization:layout.areaUtilization||areaUtilization
    };
  }

  function clearanceMetrics(layout,carton){
    const boxes=Array.isArray(layout.boxes)&&layout.boxes.length?layout.boxes:null;
    const used=boxes?extents(boxes):{
      length:(layout.counts?.[0]||0)*(layout.orientation?.[0]||0),
      width:(layout.counts?.[1]||0)*(layout.orientation?.[1]||0),
      height:(layout.counts?.[2]||0)*(layout.orientation?.[2]||0)
    };
    const residual=Array.isArray(layout.residual)&&layout.residual.length>=3
      ?layout.residual.map(value=>Math.max(0,Number(value)||0))
      :[
        Math.max(0,carton.inner[0]-used.length),
        Math.max(0,carton.inner[1]-used.width),
        Math.max(0,carton.inner[2]-used.height)
      ];
    const minAxis=Math.min(...residual);
    return{
      length:round(residual[0]),
      width:round(residual[1]),
      height:round(residual[2]),
      minAxis:round(minAxis),
      minFace:round(minAxis/2),
      used
    };
  }

  function classifyGap(gapRatio){
    if(gapRatio>=0.03)return{tier:3,level:"poor",label:"有明显缺口",message:`内部缺口 ${(gapRatio*100).toFixed(1)}%`};
    if(gapRatio>=0.015)return{tier:1,level:"small",label:"有小缺口",message:`内部缺口 ${(gapRatio*100).toFixed(1)}%`};
    return{tier:0,level:"good",label:"无明显缺口",message:`内部缺口 ${(gapRatio*100).toFixed(1)}%`};
  }

  function classifyClearance(clearance,opt){
    const min=clearance.minAxis;
    if(min<=1)return{tier:3,level:"tooTight",label:"余量过紧",message:`最小方向余量 ${min}mm`};
    if(min<4)return{tier:2,level:"tight",label:"装配偏紧",message:`最小方向余量 ${min}mm`};
    return{tier:0,level:"good",label:"余量合理",message:`最小方向余量 ${min}mm`};
  }

  function recommendation(gap,clearance,layout){
    let tier=Math.max(gap.tier,clearance.tier);
    const isMixed=layout.mode==="mixedOrientationFlat";
    const improvement=Number(layout.improvement)||0;
    if(isMixed&&improvement<=0)tier=Math.max(tier,1);
    const labels=[
      {label:"推荐装配",stars:"★★★★★"},
      {label:"可作为备选",stars:"★★★★☆"},
      {label:"谨慎确认",stars:"★★★☆☆"},
      {label:"靠后推荐",stars:"★★☆☆☆"}
    ];
    return{tier,label:labels[tier].label,stars:labels[tier].stars};
  }

  function buildTags(gap,clearance,layout,carton,opt){
    const tags=[];
    if(clearance.level==="tooTight"||clearance.level==="tight")tags.push("装配偏紧");
    if(gap.level==="poor"||gap.level==="small")tags.push(gap.label);
    if(opt?.foam&&Number(layout.foamTotal)>0&&!carton?.has_existing_foam)tags.push("无原装配套泡棉");
    return tags;
  }

  function evaluateLayout(layout,carton,box,opt){
    const footprint=footprintMetrics(layout,carton,box);
    const clearance=clearanceMetrics(layout,carton);
    const gap=classifyGap(footprint.internalGapRatio);
    const clear=classifyClearance(clearance,opt);
    const rec=recommendation(gap,clear,layout);
    const quantity=Number(layout.quantity)||0;
    const utilization=Number(layout.utilization)||0;
    const areaUtilization=Number(layout.areaUtilization)||footprint.areaUtilization||0;
    const improvement=Number(layout.improvement)||0;
    const sortScore=quantity*100000+utilization*1000+areaUtilization*500+Math.max(0,improvement)*1000-rec.tier*1000000-footprint.internalGapRatio*200000;
    return{
      footprint,
      clearance,
      gap,
      clearanceStatus:clear,
      recommendationTier:rec.tier,
      label:rec.label,
      stars:rec.stars,
      tags:buildTags(gap,clear,layout,carton,opt),
      sortScore
    };
  }

  function evaluateLayerPlan(plan,L,W,boxDims){
    const carton={inner:[Number(L)||0,Number(W)||0,Number(boxDims?.[2])||1]};
    const box={dims:[Number(boxDims?.[0])||0,Number(boxDims?.[1])||0,Number(boxDims?.[2])||1]};
    const layout={mode:"mixedOrientationFlat",boxes:plan.boxes||[],counts:[plan.boxes?.length||0,1,1],orientation:box.dims,quantity:plan.boxes?.length||0,residual:[0,0,0],areaUtilization:0};
    return evaluateLayout(layout,carton,box,{foam:false});
  }

  root.PackingEvaluator={evaluateLayout,evaluateLayerPlan,_private:{footprintMetrics,clearanceMetrics,classifyGap,classifyClearance,recommendation,extents,layerBoxes}};
})(typeof window!=="undefined"?window:globalThis);
