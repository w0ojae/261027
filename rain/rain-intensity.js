export const rainIntensity=value=>Math.max(0,Math.min(2,Number.isFinite(value)?value:1));
// Exponential interarrival distances in a cumulative rate clock; no frame-based chance.
export const rainInterval=rng=>-Math.log(1-Math.max(.02,Math.min(.999999,rng())));
