/**
 * Post-processing stage (VFX owns this file). Baseline: plain render, no effects.
 * createPost(ctx) -> { render(dt), resize(w, h), dispose() }
 * Replace with an EffectComposer (three/examples/jsm/postprocessing) keeping the same interface.
 */
export function createPost(ctx) {
  const { renderer, scene, camera } = ctx;
  return {
    render() { renderer.render(scene, camera); },
    resize() {},
    dispose() {},
  };
}
