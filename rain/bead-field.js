
export class BeadField {
  constructor(capacity=12000){
    this.cells=new Map();this.count=0;this.maxRadius=0;this.maxExtent=0;
    this.capacity=Math.min(24000,Math.max(0,Math.floor(Number.isFinite(capacity)?capacity:12000)));
  }
  add(bead){
    if(this.count>=this.capacity)return false;
    const key=`${Math.floor(bead.x/32)},${Math.floor(bead.y/32)}`;
    if(!this.cells.has(key))this.cells.set(key,[]);
    this.cells.get(key).push(bead);this.count++;this.maxRadius=Math.max(this.maxRadius,bead.r);
    this.maxExtent=Math.max(this.maxExtent,bead.r*Math.max(1,bead.aspect??1));return true;
  }
  peek(x,y,r,predicate=()=>true,exclude){
    const found=[],reach=r*1.5+Math.max(6,this.maxRadius);
    for(let cy=Math.floor((y-reach)/32);cy<=Math.floor((y+reach)/32);cy++)
    for(let cx=Math.floor((x-reach)/32);cx<=Math.floor((x+reach)/32);cx++){
      const key=`${cx},${cy}`,cell=this.cells.get(key);if(!cell)continue;
      for(const b of cell){
        if(b!==exclude&&predicate(b)&&((b.x-x)/(r*.75+b.r))**2+((b.y-y)/(r*1.2+b.r))**2<=1)found.push(b);
      }
    }
    return found;
  }
  remove(beads){
    const removals=new Map();
    for(const bead of beads){
      const key=`${Math.floor(bead.x/32)},${Math.floor(bead.y/32)}`;
      if(!removals.has(key))removals.set(key,new Set());removals.get(key).add(bead);
    }
    for(const [key,selected] of removals){
      const cell=this.cells.get(key);if(!cell)continue;
      const keep=cell.filter(bead=>!selected.has(bead));this.count-=cell.length-keep.length;
      if(keep.length)this.cells.set(key,keep);else this.cells.delete(key);
    }
  }
  take(x,y,r,predicate){const found=this.peek(x,y,r,predicate);this.remove(found);return found;}
}
