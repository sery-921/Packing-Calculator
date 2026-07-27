"use strict";

(function(root){
  const EPS=1e-9;
  const area=r=>r.length*r.width;
  const fits=(w,h,r)=>w<=r.length+EPS&&h<=r.width+EPS;
  const intersects=(a,b)=>a.x<b.x+b.length-EPS&&a.x+a.length>b.x+EPS&&a.y<b.y+b.width-EPS&&a.y+a.width>b.y+EPS;
  const contains=(a,b)=>b.x>=a.x-EPS&&b.y>=a.y-EPS&&b.x+b.length<=a.x+a.length+EPS&&b.y+b.width<=a.y+a.width+EPS;

  function rotations(boxDims){
    const [l,w,h]=boxDims.map(Number);
    const out=[{length:l,width:w,height:h,rotation:0}];
    if(Math.abs(l-w)>EPS)out.push({length:w,width:l,height:h,rotation:90});
    return out;
  }

  function makeBox(index,x,y,z,r){
    return{index,x,y,z,length:r.length,width:r.width,height:r.height,rotation:r.rotation};
  }

  function pruneFree(rects){
    const clean=rects.filter(r=>r.length>EPS&&r.width>EPS);
    return clean.filter((r,i)=>!clean.some((other,j)=>i!==j&&contains(other,r)));
  }

  function splitFreeRect(free,used){
    if(!intersects(free,used))return[free];
    const next=[];
    const freeRight=free.x+free.length,freeTop=free.y+free.width;
    const usedRight=used.x+used.length,usedTop=used.y+used.width;
    if(used.x>free.x+EPS)next.push({x:free.x,y:free.y,length:used.x-free.x,width:free.width});
    if(usedRight<freeRight-EPS)next.push({x:usedRight,y:free.y,length:freeRight-usedRight,width:free.width});
    if(used.y>free.y+EPS)next.push({x:free.x,y:free.y,length:free.length,width:used.y-free.y});
    if(usedTop<freeTop-EPS)next.push({x:free.x,y:usedTop,length:free.length,width:freeTop-usedTop});
    return next;
  }

  function contactScore(box,placed,L,W){
    let score=0;
    if(Math.abs(box.x)<EPS)score+=box.width;
    if(Math.abs(box.y)<EPS)score+=box.length;
    if(Math.abs(box.x+box.length-L)<EPS)score+=box.width;
    if(Math.abs(box.y+box.width-W)<EPS)score+=box.length;
    for(const p of placed){
      if(Math.abs(box.x-(p.x+p.length))<EPS||Math.abs(box.x+box.length-p.x)<EPS){
        const overlap=Math.max(0,Math.min(box.y+box.width,p.y+p.width)-Math.max(box.y,p.y));
        score+=overlap;
      }
      if(Math.abs(box.y-(p.y+p.width))<EPS||Math.abs(box.y+box.width-p.y)<EPS){
        const overlap=Math.max(0,Math.min(box.x+box.length,p.x+p.length)-Math.max(box.x,p.x));
        score+=overlap;
      }
    }
    return score;
  }

  function candidateScore(method,free,box,placed,L,W){
    const leftoverX=free.length-box.length,leftoverY=free.width-box.width;
    const shortSide=Math.min(leftoverX,leftoverY),longSide=Math.max(leftoverX,leftoverY);
    const areaFit=area(free)-area(box);
    if(method==="bestLongSideFit")return[longSide,shortSide,areaFit,free.y,free.x];
    if(method==="bestAreaFit")return[areaFit,shortSide,longSide,free.y,free.x];
    if(method==="bottomLeft")return[free.y,free.x,shortSide,areaFit,longSide];
    if(method==="contactPoint")return[-contactScore({...box,x:free.x,y:free.y},placed,L,W),free.y,free.x,shortSide,areaFit];
    return[shortSide,longSide,areaFit,free.y,free.x];
  }

  function betterScore(a,b){
    if(!b)return true;
    for(let i=0;i<a.length;i++){
      if(Math.abs(a[i]-b[i])>EPS)return a[i]<b[i];
    }
    return false;
  }

  function packMaxRectsLayer(L,W,boxDims,method){
    const rots=rotations(boxDims),limit=Math.floor((L*W+EPS)/(boxDims[0]*boxDims[1]));
    let free=[{x:0,y:0,length:L,width:W}],placed=[];
    while(placed.length<limit){
      let best=null,bestScore=null;
      for(const f of free){
        for(const r of rots){
          if(!fits(r.length,r.width,f))continue;
          const score=candidateScore(method,f,r,placed,L,W);
          if(betterScore(score,bestScore)){best={x:f.x,y:f.y,...r};bestScore=score}
        }
      }
      if(!best)break;
      const used={x:best.x,y:best.y,length:best.length,width:best.width};
      placed.push(makeBox(placed.length,best.x,best.y,0,best));
      free=pruneFree(free.flatMap(rect=>splitFreeRect(rect,used)));
    }
    return{method,boxes:placed,freeRectangles:free};
  }

  function gridBoxesInArea(x,y,L,W,r,startIndex){
    const boxes=[],nx=Math.floor((L+EPS)/r.length),ny=Math.floor((W+EPS)/r.width);
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++)boxes.push(makeBox(startIndex+boxes.length,x+i*r.length,y+j*r.width,0,r));
    return boxes;
  }

  function packGridSplitLayer(L,W,boxDims){
    const rots=rotations(boxDims),plans=[];
    for(const first of rots)for(const second of rots){
      const maxCols=Math.floor((L+EPS)/first.length);
      for(let cols=0;cols<=maxCols;cols++){
        const split=cols*first.length;
        let boxes=gridBoxesInArea(0,0,split,W,first,0);
        boxes=boxes.concat(gridBoxesInArea(split,0,L-split,W,second,boxes.length));
        plans.push({method:"gridVerticalSplit",boxes});
      }
      const maxRows=Math.floor((W+EPS)/first.width);
      for(let rows=0;rows<=maxRows;rows++){
        const split=rows*first.width;
        let boxes=gridBoxesInArea(0,0,L,split,first,0);
        boxes=boxes.concat(gridBoxesInArea(0,split,L,W-split,second,boxes.length));
        plans.push({method:"gridHorizontalSplit",boxes});
      }
    }
    return plans;
  }

  function extents(boxes){
    if(!boxes.length)return{length:0,width:0,height:0};
    return{
      length:Math.max(...boxes.map(b=>b.x+b.length)),
      width:Math.max(...boxes.map(b=>b.y+b.width)),
      height:Math.max(...boxes.map(b=>b.z+b.height))
    };
  }

  function scorePlan(plan,L,W){
    const count=plan.boxes.length,used=count?extents(plan.boxes):{length:0,width:0};
    const mixed=new Set(plan.boxes.map(b=>b.rotation)).size>1?1:0;
    const freePenalty=Array.isArray(plan.freeRectangles)?plan.freeRectangles.length:0;
    const evaluation=root.PackingEvaluator?.evaluateLayerPlan?.(plan,L,W,[plan.boxes[0]?.length||0,plan.boxes[0]?.width||0,1]);
    const gapPenalty=evaluation?evaluation.footprint.internalGapRatio*250000+evaluation.recommendationTier*50000:0;
    return count*100000+(count?count*area(plan.boxes[0])/(L*W):0)*1000-(freePenalty*20)-mixed*4-(used.length+used.width)*0.0001-gapPenalty;
  }

  function bestLayerPlan(L,W,boxDims){
    const methods=["bestShortSideFit","bestLongSideFit","bestAreaFit","bottomLeft","contactPoint"];
    const plans=methods.map(method=>packMaxRectsLayer(L,W,boxDims,method)).concat(packGridSplitLayer(L,W,boxDims));
    plans.sort((a,b)=>scorePlan(b,L,W)-scorePlan(a,L,W));
    const best=plans[0]||{method:"none",boxes:[],freeRectangles:[{x:0,y:0,length:L,width:W}]};
    best.freeRectangles=best.freeRectangles||[];
    return best;
  }

  function replicateLayers(layerBoxes,layers,boxH){
    const boxes=[];
    for(let k=0;k<layers;k++){
      for(const box of layerBoxes){
        boxes.push({...box,index:boxes.length,z:k*boxH});
      }
    }
    return boxes;
  }

  function validateBoxes(boxes,L,W,H){
    const warnings=[];
    for(const b of boxes){
      if(b.x<-EPS||b.y<-EPS||b.z<-EPS||b.x+b.length>L+EPS||b.y+b.width>W+EPS||b.z+b.height>H+EPS)warnings.push(`box ${b.index} out of bounds`);
    }
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
      const a=boxes[i],b=boxes[j];
      const overlap=a.x<b.x+b.length-EPS&&a.x+a.length>b.x+EPS&&a.y<b.y+b.width-EPS&&a.y+a.width>b.y+EPS&&a.z<b.z+b.height-EPS&&a.z+a.height>b.z+EPS;
      if(overlap)warnings.push(`box ${a.index} overlaps box ${b.index}`);
    }
    return warnings;
  }

  function packMixedFlat(input){
    const cartonInner=input.cartonInner.map(Number),boxDims=input.boxDims.map(Number);
    const clearance=Number(input.clearance)||0,allowFullFit=input.allowFullFit!==false;
    const usable=[
      allowFullFit?cartonInner[0]:cartonInner[0]-clearance,
      allowFullFit?cartonInner[1]:cartonInner[1]-clearance,
      allowFullFit?cartonInner[2]:cartonInner[2]-clearance
    ];
    const [L,W,H]=usable,[boxL,boxW,boxH]=boxDims;
    if(Math.min(L,W,H,boxL,boxW,boxH)<=0)return{feasible:false,mode:"mixedOrientationFlat",count:0,reason:"invalid dimensions",boxes:[]};
    if(boxH>H+EPS)return{feasible:false,mode:"mixedOrientationFlat",count:0,reason:"height overflow",boxes:[],warnings:["inner box height exceeds usable carton height"]};
    if(!rotations(boxDims).some(r=>r.length<=L+EPS&&r.width<=W+EPS))return{feasible:false,mode:"mixedOrientationFlat",count:0,reason:"footprint overflow",boxes:[],warnings:["inner box footprint does not fit in either 0 or 90 degree rotation"]};
    const layer=bestLayerPlan(L,W,boxDims),layers=Math.floor((H+EPS)/boxH);
    const boxes=replicateLayers(layer.boxes,layers,boxH),used=extents(boxes);
    const distribution=boxes.reduce((acc,b)=>{if(b.rotation===90)acc.rotation90++;else acc.rotation0++;return acc},{rotation0:0,rotation90:0});
    const warnings=validateBoxes(boxes,L,W,H);
    return{
      feasible:boxes.length>0&&warnings.length===0,
      mode:"mixedOrientationFlat",
      method:layer.method,
      count:boxes.length,
      countPerLayer:layer.boxes.length,
      layers,
      boxes,
      freeRectangles:layer.freeRectangles,
      orientationDistribution:distribution,
      areaUtilization:layer.boxes.length*boxL*boxW/(L*W),
      utilization:boxes.length*boxL*boxW*boxH/(cartonInner[0]*cartonInner[1]*cartonInner[2]),
      remaining:{
        lengthResidual:cartonInner[0]-used.length,
        widthResidual:cartonInner[1]-used.width,
        heightResidual:cartonInner[2]-used.height,
        freeRectangles:layer.freeRectangles
      },
      warnings
    };
  }

  function boxesDoNotOverlap(boxes){
    return validateBoxes(boxes,Number.POSITIVE_INFINITY,Number.POSITIVE_INFINITY,Number.POSITIVE_INFINITY).length===0;
  }

  root.PackingMixed={packMixedFlat,boxesDoNotOverlap,_private:{rotations,packMaxRectsLayer,packGridSplitLayer,validateBoxes}};
})(typeof window!=="undefined"?window:globalThis);
