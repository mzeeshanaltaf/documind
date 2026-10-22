import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";

/**
 * The high tier's subtle post-processing (a lazy chunk, loaded only on high). The composer turns
 * the renderer's tone mapping off while it runs, so it ends with its own ACES pass.
 */
export default function PostFx() {
  return (
    <EffectComposer multisampling={4}>
      <Bloom intensity={0.22} luminanceThreshold={0.86} luminanceSmoothing={0.2} mipmapBlur />
      <Vignette offset={0.34} darkness={0.32} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
