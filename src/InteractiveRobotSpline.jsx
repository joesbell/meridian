import { Suspense, lazy, useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";

const Spline = lazy(() => import("@splinetool/react-spline"));

const ROBOT_SCENE_PATH = "/assets/robot/radius-whobee.scene.splinecode";

function RobotLoading() {
  return (
    <div className="interactive-robot__loading" aria-label="正在加载交互式机器人">
      <CircleNotch weight="bold" />
      <span>ROBOT SIGNAL</span>
    </div>
  );
}

export function InteractiveRobotSpline() {
  const [ready, setReady] = useState(false);

  const handleLoad = (spline) => {
    spline.findObjectByName("Plane")?.hide();
    setReady(true);
  };

  return (
    <div
      className={`interactive-robot${ready ? " is-ready" : ""}`}
      data-robot-state={ready ? "ready" : "loading"}
      data-scene-source="local"
      data-scene-path={ROBOT_SCENE_PATH}
      role="img"
      aria-label="可跟随鼠标互动的三维电台机器人"
    >
      <Suspense fallback={<RobotLoading />}>
        <Spline
          scene={ROBOT_SCENE_PATH}
          className="interactive-robot__scene"
          onLoad={handleLoad}
        />
      </Suspense>
    </div>
  );
}
