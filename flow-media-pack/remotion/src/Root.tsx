import React from "react";
import {Composition} from "remotion";
import {EngShorts} from "./engshorts/EngShorts";

const FPS = 30;

/** 컷 데이터는 --props=cuts.json 으로 주입한다. defaultProps 는 스튜디오 미리보기용. */
export const RemotionRoot: React.FC = () => (
  <Composition
    id="EngShorts"
    component={EngShorts as never}
    durationInFrames={FPS * 95}
    fps={FPS}
    width={1080}
    height={1920}
    defaultProps={{cuts: []} as never}
    calculateMetadata={({props}: {props: {cuts?: {d?: number}[]}}) => {
      const total = (props.cuts ?? []).reduce((a, c) => a + (c.d ?? 0), 0);
      return {durationInFrames: Math.max(FPS, Math.round(total * FPS))};
    }}
  />
);
