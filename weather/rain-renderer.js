// Original, shared weather render pipeline. All intermediate targets are linear;
// the final composite performs ACES and sRGB conversion exactly once.
export function createRainRenderer(THREE,renderer,scene,{rain,ground,panes=()=>[],renderScene,mobile=false}={}){
  const size=new THREE.Vector2();
  const hdr=renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType;
  const quadScene=new THREE.Scene(),quadCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const vertexShader='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const copy=new THREE.ShaderMaterial({vertexShader,fragmentShader:'uniform sampler2D source;varying vec2 vUv;void main(){gl_FragColor=texture2D(source,vUv);}',
    uniforms:{source:{value:null}},depthTest:false,depthWrite:false,toneMapped:false});
  const bright=new THREE.ShaderMaterial({vertexShader,fragmentShader:`
    uniform sampler2D source;varying vec2 vUv;
    void main(){vec3 c=texture2D(source,vUv).rgb;float peak=max(c.r,max(c.g,c.b));
      float weight=smoothstep(.72,1.8,peak);gl_FragColor=vec4(c*weight,1.);}`,
    uniforms:{source:{value:null}},depthTest:false,depthWrite:false,toneMapped:false});
  const blur=new THREE.ShaderMaterial({vertexShader,fragmentShader:`
    uniform sampler2D source;uniform vec2 stepUV;varying vec2 vUv;
    void main(){vec3 c=texture2D(source,vUv).rgb*.227027;
      c+=(texture2D(source,vUv+stepUV*1.384615).rgb+texture2D(source,vUv-stepUV*1.384615).rgb)*.316216;
      c+=(texture2D(source,vUv+stepUV*3.230769).rgb+texture2D(source,vUv-stepUV*3.230769).rgb)*.070270;
      gl_FragColor=vec4(c,1.);}`,
    uniforms:{source:{value:null},stepUV:{value:new THREE.Vector2()}},depthTest:false,depthWrite:false,toneMapped:false});
  const composite=new THREE.ShaderMaterial({vertexShader,fragmentShader:`
    uniform sampler2D source;uniform sampler2D glow;uniform float strength;varying vec2 vUv;
    void main(){vec3 c=texture2D(source,vUv).rgb;
      c+=min(texture2D(glow,vUv).rgb,vec3(2.5))*strength;
      gl_FragColor=vec4(c,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,uniforms:{source:{value:null},glow:{value:null},strength:{value:.16}},
    depthTest:false,depthWrite:false,toneMapped:true});
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),composite);
  quad.frustumCulled=false;quadScene.add(quad);
  let color,background,glowA,glowB,disposed=false;
  const stats={sharedWindowBackground:false,backgroundSceneCaptures:0,rainOnlyDraws:0};
  function target(w,h,depth=false){
    const t=new THREE.WebGLRenderTarget(w,h,{type:hdr,depthBuffer:depth,stencilBuffer:false,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
    t.texture.colorSpace=THREE.LinearSRGBColorSpace;return t;
  }
  function resize(){
    renderer.getDrawingBufferSize(size);
    const w=Math.max(1,Math.round(size.x)),h=Math.max(1,Math.round(size.y));
    const bw=Math.max(1,Math.round(w/(mobile?8:6))),bh=Math.max(1,Math.round(h/(mobile?8:6)));
    const gw=Math.max(1,Math.round(w/4)),gh=Math.max(1,Math.round(h/4));
    if(!color){
      color=target(w,h,true);
      color.samples=Math.min(mobile?2:4,renderer.capabilities.maxSamples);
      background=target(bw,bh,true);glowA=target(gw,gh);glowB=target(gw,gh);
    }
    else if(color.width!==w||color.height!==h){color.setSize(w,h);background.setSize(bw,bh);glowA.setSize(gw,gh);glowB.setSize(gw,gh);}
  }
  function pass(material,destination){quad.material=material;renderer.setRenderTarget(destination);renderer.render(quadScene,quadCamera);}
  function render(camera,delta,{enabled=false,night=0}={}){
    if(disposed)return;
    stats.sharedWindowBackground=false;stats.backgroundSceneCaptures=0;stats.rainOnlyDraws=0;
    if(!enabled){renderScene(camera,delta);renderer.domElement.dataset.weatherEffects='dry';renderer.domElement.dataset.rainBackground='inactive';return;}
    resize();
    const glass=panes(),hidden=[rain?.group,...glass].filter(Boolean);
    ground?.reflect(renderer,camera,{hide:hidden});
    const oldTarget=renderer.getRenderTarget(),viewport=renderer.getViewport(new THREE.Vector4());
    const scissor=renderer.getScissor(new THREE.Vector4()),scissorTest=renderer.getScissorTest();
    let backgroundReady=false;
    const bindBackground=()=>{rain?.setBackground(background.texture,{width:background.width,height:background.height});backgroundReady=true;};
    const rainCapture={
      hide:rain?.group?[rain.group]:[],
      onOpaqueCaptured({texture}){
        // A wet window already needs the opaque scene at higher resolution.
        // Downsample it for airborne drops instead of drawing all models again.
        const destination=renderer.getRenderTarget(),test=renderer.getScissorTest();
        try{
          renderer.setScissorTest(false);copy.uniforms.source.value=texture;pass(copy,background);
          bindBackground();stats.sharedWindowBackground=true;
        }finally{
          // setRenderTarget restores this capture's physical viewport. Calling
          // setViewport(getViewport()) here would apply canvas DPR to a smaller
          // capture and misalign the rain-only overlay on high-DPI displays.
          renderer.setRenderTarget(destination);renderer.setScissorTest(test);
        }
      },
      renderRain(){
        if(!rain?.group?.visible)return;
        // Keep the opaque depth already in the window capture. Only airborne
        // rain is added; its sampler reads the separate downsampled texture.
        const visibility=scene.children.map(object=>[object,object.visible]);
        const backdrop=scene.background,autoClear=renderer.autoClear;
        try{
          for(const object of scene.children)if(object!==rain.group)object.visible=false;
          scene.background=null;renderer.autoClear=false;renderer.render(scene,camera);
          stats.rainOnlyDraws++;
        }finally{
          for(const [object,visible] of visibility)object.visible=visible;
          scene.background=backdrop;renderer.autoClear=autoClear;
        }
      },
      beforeFinal(){
        if(backgroundReady)return;
        // No wet pane is ready/visible: keep the original small background pass.
        const destination=renderer.getRenderTarget(),v=renderer.getViewport(new THREE.Vector4());
        const s=renderer.getScissor(new THREE.Vector4()),test=renderer.getScissorTest();
        const shadowAuto=renderer.shadowMap.autoUpdate,shadowNeeds=renderer.shadowMap.needsUpdate;
        const visibility=hidden.map(object=>object.visible);
        try{
          hidden.forEach(object=>object.visible=false);
          renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
          renderer.setScissorTest(false);renderer.setRenderTarget(background);renderer.render(scene,camera);
          stats.backgroundSceneCaptures++;bindBackground();
        }finally{
          hidden.forEach((object,index)=>object.visible=visibility[index]);
          renderer.shadowMap.autoUpdate=shadowAuto;renderer.shadowMap.needsUpdate=shadowNeeds;
          renderer.setRenderTarget(destination);renderer.setViewport(v);renderer.setScissor(s);renderer.setScissorTest(test);
        }
      },
    };
    try{
      renderer.setScissorTest(false);renderer.setRenderTarget(color);
      const draw=()=>renderScene(camera,delta,rainCapture);
      if(ground?.renderVisibility)ground.renderVisibility(camera,draw);else draw();
      bright.uniforms.source.value=color.texture;pass(bright,glowA);
      blur.uniforms.source.value=glowA.texture;blur.uniforms.stepUV.value.set(1.6/glowA.width,0);pass(blur,glowB);
      blur.uniforms.source.value=glowB.texture;blur.uniforms.stepUV.value.set(0,1.6/glowB.height);pass(blur,glowA);
      composite.uniforms.source.value=color.texture;composite.uniforms.glow.value=glowA.texture;
      composite.uniforms.strength.value=.075+Math.max(0,Math.min(1,night))*.16;
      pass(composite,oldTarget);
    }finally{
      renderer.setRenderTarget(oldTarget);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
    }
    const mode=stats.sharedWindowBackground?'shared-window':'standalone';
    if(renderer.domElement.dataset.rainBackground!==mode)renderer.domElement.dataset.rainBackground=mode;
    const groundStats=ground?.visibilityStats;
    const groundVisibility=groundStats?(groundStats.inFrustum?(groundStats.occluded?'occluded':'visible'):'outside-view'):'unknown';
    if(renderer.domElement.dataset.rainGroundVisibility!==groundVisibility)renderer.domElement.dataset.rainGroundVisibility=groundVisibility;
    renderer.domElement.dataset.weatherEffects='gpu-rain,wet-surfaces,puddles,ripples,reflection,bloom';
  }
  function dispose(){
    if(disposed)return;disposed=true;
    for(const t of [color,background,glowA,glowB])t?.dispose();
    copy.dispose();bright.dispose();blur.dispose();composite.dispose();quad.geometry.dispose();
  }
  return {render,dispose,stats};
}
