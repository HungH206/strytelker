import { useEffect, useRef, useState } from "react";
type Scene = {
  title: string;
  narrative: string;
  choices: string[];
  ending: boolean;
  location: string;
};
type Settings = { hero: string; world: string; mood: string; age: string };
type Book = { id: string; settings: Settings; scenes: Scene[]; date: string };
const heroes = [
  ["🦊", "Little Fox"],
  ["🐉", "Baby Dragon"],
  ["🐇", "Curious Rabbit"],
  ["🧑‍🚀", "Young Astronaut"],
];
const worlds = [
  ["🌲", "Moonlit Forest"],
  ["☁️", "Floating Islands"],
  ["🐚", "Underwater Kingdom"],
  ["🪐", "Starry Galaxy"],
];
const defaults = {
  hero: "Little Fox",
  world: "Moonlit Forest",
  mood: "Cozy",
  age: "6–9",
};
function readBooks(): Book[] {
  try {
    const data = JSON.parse(localStorage.getItem("lumiworld-library") || "[]");
    return Array.isArray(data)
      ? data.filter(
          (b) =>
            b &&
            typeof b.id === "string" &&
            b.settings &&
            Array.isArray(b.scenes) &&
            b.scenes.every(
              (s: Scene) =>
                typeof s.title === "string" &&
                typeof s.narrative === "string" &&
                Array.isArray(s.choices),
            ),
        )
      : [];
  } catch {
    return [];
  }
}
function Landscape({
  world,
  chapter = 0,
}: {
  world: string;
  chapter?: number;
}) {
  return (
    <div
      className={`landscape world-${worlds.findIndex((w) => w[1] === world)}`}
      aria-hidden="true"
    >
      <div className="sky-stars">
        ✦　·　　　　✧　　　　·　　✦
        <br />
        　　　✧　　　　·　　　　✦
      </div>
      <div className="moon" />
      <div className="mountain back" />
      <div className="mountain front" />
      <div className="lake" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <div className={`tree tree-${i}`} key={i} />
      ))}
      <div className="cottage">
        <span>✦</span>
        <div className="door" />
      </div>
      <div className="path" />
      <div className="traveler">
        {chapter === 0 ? "🦊" : chapter === 3 ? "🌟" : "🏮"}
      </div>
      <div className="fireflies">·　✧　　·　　　✦　　·</div>
      <div className="scene-caption">
        <span>YOUR NEXT CHAPTER IS WAITING</span>
        <strong>{world}</strong>
      </div>
    </div>
  );
}
export default function App() {
  const [tab, setTab] = useState("create");
  const [settings, setSettings] = useState<Settings>(defaults);
  const [history, setHistory] = useState<Scene[]>([]);
  const [books, setBooks] = useState<Book[]>(readBooks);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [replay, setReplay] = useState<Book | null>(null);
  const [page, setPage] = useState(0);
  const [saved, setSaved] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const busy = useRef(false);
  const pendingChoice = useRef<string | undefined>(undefined);
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setConfigured(d.geminiConfigured))
      .catch(() => setConfigured(false));
    return () => window.speechSynthesis?.cancel();
  }, []);
  const scenes = replay ? replay.scenes : history;
  const scene = replay ? scenes[page] : scenes.at(-1);
  const current = replay ? page : history.length - 1;
  function stop() {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }
  function reset() {
    stop();
    setHistory([]);
    setReplay(null);
    setError("");
    setNotice("");
    setSaved(false);
    setTab("create");
  }
  async function next(choice?: string, mode = "gemini") {
    if (busy.current) return;
    busy.current = true;
    pendingChoice.current = choice;
    stop();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, history, choice, mode }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "The story could not load.");
      if (
        !data.scene ||
        typeof data.scene.narrative !== "string" ||
        !Array.isArray(data.scene.choices)
      )
        throw new Error("The story response was incomplete.");
      setHistory((prev) => [...prev, data.scene]);
      setSource(data.source);
      setTab("story");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }
  function narrate() {
    if (speaking) {
      stop();
      return;
    }
    if (!scene || !("speechSynthesis" in window)) {
      setNotice("Narration is not supported in this browser.");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(scene.narrative);
    utterance.rate = 0.85;
    utterance.pitch = 1.08;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }
  function save() {
    if (saved) return;
    const book = {
      id: crypto.randomUUID(),
      settings,
      scenes: history,
      date: new Date().toISOString(),
    };
    const updated = [book, ...books];
    try {
      localStorage.setItem("lumiworld-library", JSON.stringify(updated));
      setBooks(updated);
      setSaved(true);
      setNotice("A little memory, kept forever in this browser.");
    } catch {
      setNotice("Your browser could not save this story. Storage may be full.");
    }
  }
  function remove(id: string) {
    try {
      const updated = books.filter((b) => b.id !== id);
      localStorage.setItem("lumiworld-library", JSON.stringify(updated));
      setBooks(updated);
    } catch {
      setNotice("Your browser could not update the library.");
    }
  }
  return (
    <div className="app">
      <header>
        <button className="brand" onClick={reset} disabled={loading}>
          <span className="brand-moon">☾</span>Lumi<span>World</span>
          <i>✦</i>
        </button>
        <nav aria-label="Main navigation">
          <button
            className={tab !== "library" ? "active" : ""}
            onClick={() => {
              stop();
              setTab(scene ? "story" : "create");
            }}
          >
            ✧ Adventures
          </button>
          <button
            className={tab === "library" ? "active" : ""}
            onClick={() => {
              stop();
              setTab("library");
            }}
          >
            ▤ My storybook <span className="count">{books.length}</span>
          </button>
        </nav>
        <div className="header-note">
          A little wonder, every day <span>✦</span>
        </div>
      </header>
      <main>
        {tab === "library" ? (
          <>
            <div className="intro">
              <p className="eyebrow">LITTLE MOMENTS, BIG MEMORIES</p>
              <h1>
                Your shelf of <em>wonders.</em>
              </h1>
              <p>Every adventure has a place to call home.</p>
            </div>
            <div className="library">
              {books.length ? (
                books.map((book) => (
                  <article className="book" key={book.id}>
                    <Landscape world={book.settings.world} />
                    <div className="book-body">
                      <span className="eyebrow">
                        {book.settings.hero} · {book.scenes.length} chapters
                      </span>
                      <h2>{book.scenes[0]?.title}</h2>
                      <p>{new Date(book.date).toLocaleDateString()}</p>
                      <button
                        className="primary"
                        onClick={() => {
                          stop();
                          setReplay(book);
                          setPage(0);
                          setTab("story");
                          setError("");
                          setNotice("");
                        }}
                      >
                        Read again ↗
                      </button>
                      <button
                        className="text-button"
                        onClick={() => remove(book.id)}
                      >
                        Remove from library
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty">
                  <span>📖</span>
                  <h2>A whole shelf of possibilities.</h2>
                  <p>Finish an adventure and save it here to read again.</p>
                  <button className="primary" onClick={reset}>
                    Create your first story ✦
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="intro">
              <p className="eyebrow">
                A SMALL COMPANION. AN INFINITE IMAGINATION.
              </p>
              <h1>
                {scene ? "One choice. A little more " : "Little stories. "}
                <em>{scene ? "magic." : "Limitless wonder."}</em>
              </h1>
              <p>
                {scene
                  ? "Take your time. The next chapter belongs to you."
                  : "Meet Lumi, your guide to worlds only you can dream up."}
              </p>
            </div>
            <div className="adventure-grid">
              <section className="visual-panel">
                <Landscape
                  world={replay ? replay.settings.world : settings.world}
                  chapter={Math.max(0, current)}
                />
                <div className="lumi-note">
                  <div className="lumi-orb">✦</div>
                  <div>
                    <strong>
                      {scene
                        ? "“You make this story magical.”"
                        : "“Hello, dreamer. Where shall we go?”"}
                    </strong>
                    <p>
                      {scene
                        ? "A little courage. A little kindness. A world of possibility."
                        : "Pick a friend, find your world, and let’s make a little magic."}
                    </p>
                  </div>
                </div>
                <div className="map">
                  <p className="eyebrow">
                    OUR LITTLE WORLD <span>✧</span>
                  </p>
                  <div className="map-stops">
                    {["Willow Home", "Moonlit Lake", "Crystal Cave"].map(
                      (place, i) => (
                        <div
                          className={
                            scene?.location === place || (!scene && i === 0)
                              ? "visited"
                              : ""
                          }
                          key={place}
                        >
                          <span>{["⌂", "≈", "◇"][i]}</span>
                          <small>{place}</small>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              </section>
              <section className="creator" aria-busy={loading}>
                {!scene ? (
                  <>
                    <div className="panel-heading">
                      <span className="step">01 / THE BEGINNING</span>
                      <span>✧</span>
                    </div>
                    <h2>Dream up your adventure</h2>
                    <p className="muted">
                      Every great story starts with a little you.
                    </p>
                    <fieldset disabled={loading}>
                      <legend>
                        <b>1</b> Who’s our hero?
                      </legend>
                      <div className="options heroes">
                        {heroes.map(([icon, name]) => (
                          <button
                            type="button"
                            aria-pressed={settings.hero === name}
                            className={settings.hero === name ? "selected" : ""}
                            key={name}
                            onClick={() =>
                              setSettings({ ...settings, hero: name })
                            }
                          >
                            <span>{icon}</span>
                            {name}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset disabled={loading}>
                      <legend>
                        <b>2</b> A world to get lost in
                      </legend>
                      <div className="options worlds">
                        {worlds.map(([icon, name]) => (
                          <button
                            type="button"
                            aria-pressed={settings.world === name}
                            className={
                              settings.world === name ? "selected" : ""
                            }
                            key={name}
                            onClick={() =>
                              setSettings({ ...settings, world: name })
                            }
                          >
                            <span>{icon}</span>
                            {name}
                            <i>{settings.world === name ? "✓" : "+"}</i>
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <div className="settings-row">
                      <fieldset disabled={loading}>
                        <legend>
                          <b>3</b> A sprinkle of feeling
                        </legend>
                        <div className="moods">
                          {["Cozy", "Adventurous", "Funny"].map((mood, i) => (
                            <button
                              aria-pressed={settings.mood === mood}
                              className={
                                settings.mood === mood ? "selected" : ""
                              }
                              onClick={() => setSettings({ ...settings, mood })}
                              key={mood}
                            >
                              {["☕", "🧭", "☺"][i]} {mood}
                            </button>
                          ))}
                        </div>
                      </fieldset>
                      <label className="age">
                        Reading age
                        <select
                          disabled={loading}
                          value={settings.age}
                          onChange={(e) =>
                            setSettings({ ...settings, age: e.target.value })
                          }
                        >
                          {["4–5", "6–9", "10–12"].map((a) => (
                            <option key={a}>{a}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <button
                      className="primary begin"
                      disabled={loading}
                      onClick={() => next()}
                    >
                      {loading
                        ? "Lumi is imagining…"
                        : "Let’s begin our adventure"}{" "}
                      <span>✦ →</span>
                    </button>
                    <p className="tiny">
                      {configured
                        ? "✦ Powered by Gemini · Created just for you"
                        : "✧ Demo ready · Four chapters of gentle magic"}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="panel-heading">
                      <span className="step">
                        CHAPTER {current + 1} OF{" "}
                        {scenes.length === 4 || !replay ? 4 : scenes.length}
                      </span>
                      <span className="mode">
                        {replay
                          ? "Saved adventure"
                          : source === "gemini"
                            ? "✦ Gemini story"
                            : "✧ Demo story"}
                      </span>
                    </div>
                    <div className="progress">
                      {[0, 1, 2, 3].map((i) => (
                        <span
                          className={i <= current ? "filled" : ""}
                          key={i}
                        />
                      ))}
                    </div>
                    <h2 className="story-title">{scene.title}</h2>
                    <p className="narrative">{scene.narrative}</p>
                    <button className="listen" onClick={narrate}>
                      {speaking ? "◼ Stop reading" : "♫ Read it to me"}
                    </button>
                    {replay ? (
                      <div className="replay-controls">
                        <button
                          disabled={page === 0}
                          onClick={() => {
                            stop();
                            setPage(page - 1);
                          }}
                        >
                          ← Previous
                        </button>
                        <button
                          disabled={page === scenes.length - 1}
                          onClick={() => {
                            stop();
                            setPage(page + 1);
                          }}
                        >
                          Next chapter →
                        </button>
                      </div>
                    ) : scene.ending ? (
                      <div className="ending">
                        <span>✧ THE END ✧</span>
                        <h3>A memory worth keeping.</h3>
                        <button
                          className="primary"
                          disabled={saved}
                          onClick={save}
                        >
                          {saved
                            ? "✓ Saved to your storybook"
                            : "Save to my storybook ♡"}
                        </button>
                      </div>
                    ) : (
                      <div className="choices">
                        <p className="eyebrow">WHAT HAPPENS NEXT?</p>
                        {scene.choices.map((choice, i) => (
                          <button
                            disabled={loading}
                            key={choice}
                            onClick={() =>
                              next(
                                choice,
                                source === "demo" ? "demo" : "gemini",
                              )
                            }
                          >
                            <span>{i === 0 ? "✧" : "☾"}</span>
                            {choice}
                            <i>→</i>
                          </button>
                        ))}
                      </div>
                    )}
                    {loading && (
                      <p role="status" className="tiny">
                        Lumi is imagining your next chapter…
                      </p>
                    )}
                    <button
                      className="text-button"
                      disabled={loading}
                      onClick={reset}
                    >
                      Start a new adventure ↗
                    </button>
                  </>
                )}
                {error && (
                  <div role="alert" className="error">
                    {error}
                    <button
                      disabled={loading}
                      onClick={() => next(pendingChoice.current, "demo")}
                    >
                      Continue in demo mode →
                    </button>
                  </div>
                )}
                {notice && (
                  <p className="notice" role="status">
                    {notice}
                  </p>
                )}
              </section>
            </div>
          </>
        )}
        <footer>
          <span>☾ Made for little dreamers and their grown-ups.</span>
          <span>
            Kind stories. Curious minds. <i>Endless possibilities.</i>
          </span>
        </footer>
      </main>
    </div>
  );
}
