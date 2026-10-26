import {createRainPane} from './rain/simulation.js?v=37';
import {createRainWindow} from './rain/window-material.js?v=36';
import {createPaneVisibility} from './rain/pane-visibility.js?v=27';

// Logical glass sizes are fixed in model space: moving the camera or resizing
// the viewport must never move, stretch or reseed the water on a pane.
const pixelsPerModelUnit=256;

export function createWindowRain(THREE,renderer,scene,panes,{reducedMotion=false,onError=console.error}={}){
  // One water body per outer glass surface, shared by views from both sides.
  const entries=panes.map((pane,index)=>({pane,index,original:pane.material,simulation:null,window:null,pending:null,failed:false}));
  const dryMaterial=panes[0].material.clone();dryMaterial.transmission=0;
  const visibilityTest=createPaneVisibility(THREE,renderer,panes);
  const frustum=new THREE.Frustum(),projection=new THREE.Matrix4(),bufferSize=new THREE.Vector2();
  const hdr=renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType;
  let capture,blurA,blurB,lens,disposed=false,active=false;
  const canvas=renderer.domElement;
  function record(key,value){if(canvas.dataset[key]!==value)canvas.dataset[key]=value;}
  function report(ready=[],candidates=[],visible=candidates){
    const ids=ready.map(entry=>entry.index).join(',');
    const revision=ready.map(entry=>`${entry.index}:${entry.simulation.map.revision||0}`).join(',');
    record('rainPanes',ids);
    record('rainRevision',revision);
    record('rainVisibility',visibilityTest.stats.supported?'gpu-occlusion':'frustum');
    record('rainCandidates',candidates.map(entry=>entry.index).join(','));
    record('rainOccluded',candidates.filter(entry=>!visible.includes(entry)).map(entry=>entry.index).join(','));
    record('rainStoredRevision',entries.filter(entry=>entry.simulation).map(entry=>`${entry.index}:${entry.simulation.map.revision||0}`).join(','));
  }
  const quadCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const quadScene=new THREE.Scene();
  const filterMaterial=new THREE.ShaderMaterial({
    uniforms:{source:{value:null},stepUV:{value:new THREE.Vector2()}},
    vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`uniform sampler2D source;uniform vec2 stepUV;varying vec2 vUv;
      void main(){vec3 c=texture2D(source,vUv).rgb*.227027;
      c+=(texture2D(source,vUv+stepUV*1.384615).rgb+texture2D(source,vUv-stepUV*1.384615).rgb)*.316216;
      c+=(texture2D(source,vUv+stepUV*3.230769).rgb+texture2D(source,vUv-stepUV*3.230769).rgb)*.070270;
      gl_FragColor=vec4(c,1.);}`,
    depthTest:false,depthWrite:false,toneMapped:false
  });
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),filterMaterial);quad.frustumCulled=false;quadScene.add(quad);
  const copyMaterial=new THREE.ShaderMaterial({
    uniforms:{source:{value:null}},vertexShader:filterMaterial.vertexShader,
    fragmentShader:'uniform sampler2D source;varying vec2 vUv;void main(){gl_FragColor=texture2D(source,vUv);}',
    depthTest:false,depthWrite:false,toneMapped:false,
  });
  function target(width,height,depth=false){
    const t=new THREE.WebGLRenderTarget(width,height,{type:hdr,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:depth,stencilBuffer:false});
    if(depth)t.depthTexture=new THREE.DepthTexture(width,height,THREE.UnsignedIntType);
    t.texture.colorSpace=THREE.LinearSRGBColorSpace;return t;
  }
  function resizeTargets(){
    renderer.getDrawingBufferSize(bufferSize);
    // The scene is captured once, shared by every pane; blur is entirely GPU work.
    const scale=Math.min(1,1600/Math.max(bufferSize.x,bufferSize.y));
    const w=Math.max(1,Math.round(bufferSize.x*scale)),h=Math.max(1,Math.round(bufferSize.y*scale));
    const bw=Math.max(1,Math.round(w/3)),bh=Math.max(1,Math.round(h/3));
    const lh=Math.max(1,Math.round(96*h/w));
    if(!capture){capture=target(w,h,true);blurA=target(bw,bh);blurB=target(bw,bh);lens=target(96,lh);}
    else if(capture.width!==w||capture.height!==h){capture.setSize(w,h);blurA.setSize(bw,bh);blurB.setSize(bw,bh);lens.setSize(96,lh);}
  }
  function start(entry){
    if(entry.pending||entry.failed||entry.simulation||disposed)return;
    const {width:w,height:h}=entry.pane.geometry.parameters;
    const width=Math.max(1,Math.round(w*pixelsPerModelUnit)),height=Math.max(1,Math.round(h*pixelsPerModelUnit));
    entry.pending=createRainPane({width,height}).then(simulation=>{
      if(disposed){simulation.dispose();return;}
      entry.simulation=simulation;entry.window=createRainWindow(THREE,simulation);
    }).catch(error=>{entry.failed=true;onError(error);}).finally(()=>{entry.pending=null;});
  }
  function filter(source,destination,x=0,y=0){
    quad.material=filterMaterial;
    filterMaterial.uniforms.source.value=source;
    filterMaterial.uniforms.stepUV.value.set(x,y);
    renderer.setRenderTarget(destination);renderer.render(quadScene,quadCamera);
  }
  function render(camera,delta,{enabled=false,rainCapture}={}){
    if(disposed){rainCapture?.beforeFinal();renderer.render(scene,camera);return;}
    active=enabled;
    // Restore ordinary glass immediately on leaving first-person or rainy weather.
    for(const entry of entries)entry.pane.material=enabled?dryMaterial:entry.original;
    if(!enabled){visibilityTest.reset();for(const entry of entries)entry.simulation?.setActive(false);report();rainCapture?.beforeFinal();renderer.render(scene,camera);return;}
    scene.updateMatrixWorld();camera.updateMatrixWorld();
    projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(projection);
    // Outdoor walking can see windows on either floor. Visibility comes from
    // the camera and opaque scene depth, never the selected indoor room.
    const candidates=entries.filter(entry=>entry.pane.visible&&frustum.intersectsObject(entry.pane));
    const visiblePanes=visibilityTest.select(camera,candidates.map(entry=>entry.pane));
    const visible=candidates.filter(entry=>visiblePanes.includes(entry.pane));
    for(const entry of visible)start(entry);
    const ready=visible.filter(entry=>entry.simulation&&entry.window);
    for(const entry of entries)if(!ready.includes(entry))entry.simulation?.setActive(false);
    if(!ready.length){report(ready,candidates,visible);rainCapture?.beforeFinal();visibilityTest.render(camera,()=>renderer.render(scene,camera));return;}
    resizeTargets();
    for(const entry of ready){
      entry.simulation.setActive(!reducedMotion);entry.simulation.update(delta);
      entry.pane.material=entry.window.material;
    }
    report(ready,candidates,visible);
    const previousTarget=renderer.getRenderTarget(),shadowAuto=renderer.shadowMap.autoUpdate,shadowNeeds=renderer.shadowMap.needsUpdate;
    const visibility=entries.map(entry=>entry.pane.visible);
    const extraHidden=(rainCapture?.hide||[]).map(object=>[object,object.visible]);
    const viewport=renderer.getViewport(new THREE.Vector4()),scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest();
    try{
      for(const entry of entries)entry.pane.visible=false;
      for(const [object] of extraHidden)object.visible=false;
      renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
      renderer.setScissorTest(false);renderer.setRenderTarget(capture);renderer.render(scene,camera);
      if(rainCapture){
        rainCapture.onOpaqueCaptured({texture:capture.texture,width:capture.width,height:capture.height});
        for(const [object,visible] of extraHidden)object.visible=visible;
        rainCapture.renderRain();
      }
      filter(capture.texture,blurA,1.2/blurA.width,0);
      filter(blurA.texture,blurB,0,1.2/blurA.height);
      copyMaterial.uniforms.source.value=capture.texture;quad.material=copyMaterial;
      renderer.setRenderTarget(lens);renderer.render(quadScene,quadCamera);
    }finally{
      entries.forEach((entry,index)=>{entry.pane.visible=visibility[index];});
      for(const [object,visible] of extraHidden)object.visible=visible;
      renderer.shadowMap.autoUpdate=shadowAuto;renderer.shadowMap.needsUpdate=shadowNeeds;
      renderer.setRenderTarget(previousTarget);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
    }
    for(const entry of ready)entry.window.update(capture.texture,{width:bufferSize.x,height:bufferSize.y},{blurTexture:blurB.texture,lensTexture:lens.texture,depthTexture:capture.depthTexture,projectionInverse:camera.projectionMatrixInverse,depthMargin:.06});
    rainCapture?.beforeFinal();
    visibilityTest.render(camera,()=>renderer.render(scene,camera));
  }
  function dispose(){
    disposed=true;active=false;
    visibilityTest.dispose();
    for(const entry of entries){entry.pane.material=entry.original;entry.window?.dispose();entry.simulation?.dispose();}
    for(const t of [capture,blurA,blurB,lens])t?.dispose();quad.geometry.dispose();filterMaterial.dispose();copyMaterial.dispose();
    dryMaterial.dispose();
  }
  return {render,dispose,get active(){return active;}};
}
