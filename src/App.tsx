import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ShoppingPanel, {
  stageLocations,
  type ShoppingStage,
} from "./ShoppingPanel";
import { Icon, stops, type Stop } from "./town";
import "./index.css";

const WorldScene = lazy(() =>
  import("./WorldScene").then((module) => ({ default: module.WorldScene })),
);
const stages: ShoppingStage[] = [
  "hq",
  "dealer",
  "finance",
  "checkout",
  "complete",
];
const stageNames = [
  "Your preferences",
  "Your garage stash",
  "Your payment plan",
  "Payment + insurance",
  "Your next drive",
];

class WorldBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="world-fallback" role="status">
        The 3D view is unavailable. Explore the locations below and continue
        shopping in the panel.
      </div>
    ) : (
      this.props.children
    );
  }
}

export default function App() {
  const panel = useRef<HTMLElement>(null);
  const [stage, setStage] = useState<ShoppingStage>("hq");
  const chapter = stages.indexOf(stage) + 1;
  const [selected, setSelected] = useState<Stop>("hq");
  const [navigationRequest, setNavigationRequest] = useState<{
    stop: Stop;
    id: number;
  } | null>(null);
  const [follow, setFollow] = useState(true);
  const [cameraVersion, setCameraVersion] = useState(0);
  const currentStop = stageLocations[stage];
  const viewedStop = follow ? currentStop : selected;

  useEffect(() => {
    panel.current?.scrollTo({ top: 0 });
  }, [chapter]);

  function inspect(stop: Stop) {
    setNavigationRequest((current) => ({ stop, id: (current?.id ?? 0) + 1 }));
    setSelected(stop);
    setFollow(false);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="spark" size={19} />
          </span>
          <span>
            <strong>TOYO Pocket Agent</strong>
            <small>Your Toyota. Your terms.</small>
          </span>
        </div>
        <div className="status">
          <span />
          Step {chapter} of 5 ·{" "}
          {chapter === 5 ? "Journey complete" : "Shopping in progress"}
        </div>
        <div className="top-actions">
          <button
            className="ghost-button"
            aria-pressed={follow}
            onClick={() => {
              setSelected(currentStop);
              setFollow(!follow);
            }}
          >
            <Icon name="pin" size={16} />
            {follow ? "Following agent" : "Follow agent"}
          </button>
          <button
            className="icon-button"
            aria-label="Reset camera"
            onClick={() => setCameraVersion((version) => version + 1)}
          >
            <Icon name="reset" />
          </button>
        </div>
      </header>
      <section className="world" aria-label="Interactive Toyota shopping town">
        <div className="three-world">
          <WorldBoundary key={cameraVersion}>
            <Suspense
              fallback={
                <div className="world-fallback" role="status">
                  Opening the Toyota town…
                </div>
              }
            >
              <WorldScene
                selected={viewedStop}
                currentStop={currentStop}
                running={chapter > 1 && chapter < 5}
                onSelect={inspect}
              />
            </Suspense>
          </WorldBoundary>
        </div>
        <div className="world-title">
          <span>TOYO WORLD · YOUR NEXT DRIVE</span>
          <h1>A smart little guide. A big next step.</h1>
          <p>Meet TOYO at HQ. Find your fit. Drive your decision.</p>
        </div>
        <nav className="town-locations" aria-label="Town locations">
          {(Object.keys(stops) as Stop[]).map((stop) => (
            <button
              key={stop}
              aria-pressed={viewedStop === stop}
              onClick={() => inspect(stop)}
            >
              <Icon name={stops[stop].icon} size={16} />
              {stops[stop].label}
            </button>
          ))}
        </nav>
        <div className="agent-caption">
          <span>
            <Icon name="spark" size={16} />
          </span>
          <div>
            <small>TOYO · YOUR SHOPPING AGENT</small>
            <b>{stageNames[chapter - 1]}</b>
          </div>
        </div>
        <div className="location-card">
          <span className="location-icon">
            <Icon name={stops[viewedStop].icon} />
          </span>
          <div>
            <small>NOW VIEWING</small>
            <strong>{stops[viewedStop].label}</strong>
          </div>
        </div>
      </section>
      <aside
        ref={panel}
        className="dashboard story-panel"
        aria-label="Your Toyota shopping plan"
      >
        <div className="story-progress">
          {["HQ", "Garage", "Finance", "Confirm", "Complete"].map(
            (label, index) => (
              <div
                key={label}
                className={index < chapter ? "active" : ""}
                aria-current={index + 1 === chapter ? "step" : undefined}
              >
                <i>{index + 1}</i>
                <span>{label}</span>
              </div>
            ),
          )}
        </div>
        <p className="demo-notice">
          Shopping simulation · Catalog MSRPs, illustrative finance terms
        </p>
        <ShoppingPanel
          onStageChange={setStage}
          navigationRequest={navigationRequest}
        />
        <a className="legacy-link" href="/?lumi">
          Visit LumiWorld ↗
        </a>
      </aside>
    </main>
  );
}
