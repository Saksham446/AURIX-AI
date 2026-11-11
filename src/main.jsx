
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Plus, Send, Mic, MicOff, ImagePlus, Camera, Search, Menu, X,
  Trash2, Volume2, MessageSquare, LoaderCircle, Sun, Moon, Square
} from "lucide-react";
import "./style.css";

// API HELPERS
const request = async (url, options = {}) => {
  const response = await fetch(url, options);
  const raw = await response.text();

  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        `Server returned an invalid response (${response.status}). ` +
        (raw.slice(0, 180) || "No response body.")
      );
    }
  }

  if (!response.ok) {
    const message =
      typeof data.error === "string"
        ? data.error
        : data.error?.message || data.message ||
          `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  if (!raw) {
    throw new Error(`Server returned an empty response (${response.status}).`);
  }

  return data;
};

const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

// SELECT THE BEST VOICE INSTALLED IN THE BROWSER
function getPreferredVoice(text) {
  if (!("speechSynthesis" in window)) return null;

  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return null;

  const hindi = /[\u0900-\u097F]/.test(text);

  const languages = hindi
    ? ["hi-IN", "hi"]
    : ["en-IN", "en-GB", "en-US", "en"];

  for (const language of languages) {
    const matches = voices.filter(
      (voice) =>
        voice.lang?.toLowerCase() === language.toLowerCase()
    );

    if (matches.length) {
      return matches.find((voice) =>
        /google|microsoft|neural|premium|natural|samantha|ava/i.test(voice.name)
      ) || matches[0];
    }
  }

  return voices.find((voice) =>
    /google|microsoft|samantha|ava|natural|premium/i.test(voice.name)
  ) || voices[0];
}

// CREATE NATURALER SPEECH SETTINGS
function createAURIXUtterance(text) {
  const utterance = new SpeechSynthesisUtterance(text);

  utterance.lang = /[\u0900-\u097F]/.test(text)
    ? "hi-IN"
    : "en-IN";

  utterance.rate = 0.94;
  utterance.pitch = 1;
  utterance.volume = 1;

  const voice = getPreferredVoice(text);

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang || utterance.lang;
  }

  return utterance;
}

function App() {
  const [chats, setChats] = useState([]);
  const [id, setId] = useState(null);
  const [input, setInput] = useState("");
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [side, setSide] = useState(false);
  const [mode, setMode] = useState("chat");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [live, setLive] = useState(false);
  const [liveAnswer, setLiveAnswer] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceConversation, setVoiceConversation] = useState(false);
  const [dark, setDark] = useState(true);

  const fileRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const bottom = useRef(null);
  const lock = useRef(false);
  const timer = useRef(null);
  const liveQuestionRef = useRef(null);
  const recognitionRef = useRef(null);
  const voiceModeRef = useRef(false);
  const recognitionRestartRef = useRef(null);

  const current = chats.find((chat) => chat.id === id);

  // LOAD CHAT HISTORY
  const refresh = async () => {
    const data = await request("/api/chats");
    setChats(data);
    return data;
  };

  // SAFE INITIALIZATION AND CLEANUP
  useEffect(() => {
    let mounted = true;

    const loadChats = async () => {
      try {
        const data = await request("/api/chats");

        if (mounted) {
          setChats(data);

          if (data.length > 0) {
            setId(data[0].id);
          }
        }
      } catch (err) {
        if (mounted) {
          setError(err.message);
        }
      }
    };

    loadChats();

    return () => {
      mounted = false;

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
        streamRef.current = null;
      }

      if (recRef.current && recRef.current.state !== "inactive") {
        recRef.current.stop();
      }

      if (timer.current !== null) {
        window.clearInterval(timer.current);
        timer.current = null;
      }

      voiceModeRef.current = false;

      if (recognitionRestartRef.current) {
        window.clearTimeout(recognitionRestartRef.current);
        recognitionRestartRef.current = null;
      }

      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        try {
          recognitionRef.current.stop();
        } catch {}
        recognitionRef.current = null;
      }

      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // AUTO SCROLL
  useEffect(() => {
    if (bottom.current) {
      bottom.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [current?.messages?.length, busy]);

  // CREATE NEW CHAT
  async function newChat() {
    try {
      const chat = await request("/api/chats", json({
        title: "New chat"
      }));

      setChats((old) => [chat, ...old]);
      setId(chat.id);
      setSide(false);
      setMode("chat");
      setError("");

      return chat.id;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }

  // SEND MESSAGE
  async function send() {
    if (busy || (!input.trim() && !image)) return;

    setBusy(true);
    setError("");

    const text = input.trim();
    const uploadedImage = image;

    setInput("");
    setImage(null);

    try {
      let chatId = id;

      if (!chatId) {
        const chat = await request("/api/chats", json({
          title: text.slice(0, 35) || "New chat"
        }));

        chatId = chat.id;
        setId(chatId);
        setChats((old) => [chat, ...old]);
      }

      setChats((old) =>
        old.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                messages: [
                  ...(chat.messages || []),
                  {
                    id: "temp-" + Date.now(),
                    role: "user",
                    text,
                    image: uploadedImage
                  }
                ]
              }
            : chat
        )
      );

      await request("/api/chat", json({
        chatId,
        text,
        image: uploadedImage
      }));

      await refresh();
    } catch (err) {
      setError(err.message);
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  // DELETE CHAT
  async function removeChat(chatId) {
    if (!window.confirm("Delete this conversation?")) return;

    try {
      await request("/api/chats/" + chatId, {
        method: "DELETE"
      });

      const all = await refresh();

      if (id === chatId) {
        setId(all[0]?.id || null);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  // IMAGE UPLOAD
  function attach(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif"
    ];

    if (!allowed.includes(file.type) || file.size > 7 * 1024 * 1024) {
      setError("Choose PNG, JPEG, WebP or GIF smaller than 7 MB.");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      setImage(reader.result);
      setMode("chat");
      setError("");
    };

    reader.onerror = () => {
      setError("Unable to read this image.");
    };

    reader.readAsDataURL(file);
    event.target.value = "";
  }

  // INTERNET IMAGE SEARCH
  async function searchImages() {
    if (!query.trim() || busy) return;

    setBusy(true);
    setError("");

    try {
      const data = await request(
        "/api/image-search?q=" + encodeURIComponent(query)
      );

      setResults(data.images || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // TEXT TO SPEECH
  function speak(text) {
    if (!("speechSynthesis" in window)) {
      setError("Speech playback is not supported.");
      return;
    }

    if (
      window.speechSynthesis.speaking ||
      window.speechSynthesis.pending
    ) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }

    const utterance = createAURIXUtterance(text);

    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  // VOICE INPUT
  async function toggleRecording() {
    if (recording) {
      if (recRef.current && recRef.current.state !== "inactive") {
        recRef.current.stop();
      }

      setRecording(false);
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access is unavailable.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true
      });

      const mimeTypes = [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm"
      ];

      const mime = mimeTypes.find((type) =>
        MediaRecorder.isTypeSupported(type)
      );

      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined
      );

      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);

        if (chunksRef.current.length === 0) return;

        setBusy(true);

        try {
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm"
          });

          const data = await request("/api/transcribe", {
            method: "POST",
            headers: {
              "Content-Type": blob.type.split(";")[0]
            },
            body: blob
          });

          setInput((previous) =>
            [previous, data.text].filter(Boolean).join(" ")
          );
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
      };

      recorder.onerror = () => {
        setRecording(false);
        setError("Recording failed.");
      };

      recRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch (err) {
      setError("Microphone error: " + err.message);
    }
  }

  // HANDS-FREE VOICE CONVERSATION
  function stopVoiceConversation() {
    voiceModeRef.current = false;
    setVoiceConversation(false);

    if (recognitionRestartRef.current) {
      window.clearTimeout(recognitionRestartRef.current);
      recognitionRestartRef.current = null;
    }

    if (recognitionRef.current) {
      recognitionRef.current.onend = null;

      try {
        recognitionRef.current.stop();
      } catch {}

      recognitionRef.current = null;
    }

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  function listenForNextQuestion() {
    if (!voiceModeRef.current) return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError(
        "Voice recognition is not supported in this browser. Use the latest Chrome."
      );
      stopVoiceConversation();
      return;
    }

    const recognition = new SpeechRecognition();

    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "hi-IN";

    setLiveAnswer("Listening... Please ask your question.");

    recognition.onresult = async (event) => {
      const result = event.results[event.results.length - 1];

      if (!result?.isFinal) return;

      const question = result[0]?.transcript?.trim();

      if (!question || !voiceModeRef.current) return;

      // Stop recognition before AI response.
      recognition.onend = null;

      try {
        recognition.stop();
      } catch {}

      recognitionRef.current = null;

      if (liveQuestionRef.current) {
        liveQuestionRef.current.value = question;
      }

      setLiveAnswer(`You asked: "${question}"`);

      await analyzeFrame(question, true);
    };

    recognition.onerror = (event) => {
      if (!voiceModeRef.current) return;

      if (event.error === "no-speech") {
        recognitionRestartRef.current = window.setTimeout(
          listenForNextQuestion,
          500
        );
        return;
      }

      setError("Voice recognition error: " + event.error);

      recognitionRestartRef.current = window.setTimeout(
        listenForNextQuestion,
        1200
      );
    };

    recognition.onend = () => {
      // Listening resumes only after speech playback finishes.
    };

    try {
      recognition.start();
    } catch (err) {
      setError("Could not start microphone: " + err.message);
      stopVoiceConversation();
    }
  }

  function startVoiceConversation() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError(
        "Voice conversation is not supported in this browser. Please use the latest Google Chrome."
      );
      return;
    }

    if (!live || !videoRef.current?.videoWidth) {
      setError("Start the camera and wait for the preview first.");
      return;
    }

    stopVoiceConversation();

    voiceModeRef.current = true;
    setVoiceConversation(true);
    setError("");

    listenForNextQuestion();
  }

  // ATTACH CAMERA STREAM AFTER VIDEO ELEMENT IS RENDERED
  useEffect(() => {
    if (!live) return;

    const video = videoRef.current;
    const stream = streamRef.current;

    if (!video || !stream) {
      setLiveAnswer("Camera is initializing...");
      return;
    }

    let cancelled = false;

    const attachAndPlay = async () => {
      try {
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;

        if (video.readyState < 1) {
          await new Promise((resolve, reject) => {
            const onLoaded = () => {
              cleanup();
              resolve();
            };

            const onError = () => {
              cleanup();
              reject(
                new Error("The camera stream could not be loaded.")
              );
            };

            const cleanup = () => {
              video.removeEventListener("loadedmetadata", onLoaded);
              video.removeEventListener("error", onError);
            };

            video.addEventListener(
              "loadedmetadata",
              onLoaded,
              { once: true }
            );

            video.addEventListener(
              "error",
              onError,
              { once: true }
            );
          });
        }

        if (cancelled) return;

        await video.play();

        if (!cancelled) {
          setLiveAnswer(
            "Camera is ready. Ask a question and tap Analyze."
          );
        }
      } catch (err) {
        if (!cancelled) {
          setLiveAnswer("");
          setError("Camera preview failed: " + err.message);
        }
      }
    };

    attachAndPlay();

    return () => {
      cancelled = true;
    };
  }, [live]);

  // START LIVE CAMERA
  async function startLive() {
    if (live || streamRef.current) return;

    setError("");
    setLiveAnswer("Requesting camera access...");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Camera access is unavailable. Open AURIX AI on localhost or HTTPS."
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      streamRef.current = stream;
      setLive(true);
      setLiveAnswer("Camera connected. Preparing preview...");
    } catch (err) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      setLive(false);
      setLiveAnswer("");

      setError("Camera access failed: " + err.message);
    }
  }

  // STOP LIVE CAMERA
  function stopLive() {
    stopVoiceConversation();

    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    setLive(false);
    setLiveAnswer("");
  }

  // ANALYZE CURRENT CAMERA FRAME FOR THE USER'S EXACT QUESTION
  async function analyzeFrame(
    questionOverride = "",
    speakAnswer = false
  ) {
    if (lock.current) return;

    const video = videoRef.current;

    if (!video || !video.videoWidth || !video.videoHeight) {
      setError("Camera is not ready yet. Please wait for the preview.");
      return;
    }

    const userQuestion =
      (questionOverride || liveQuestionRef.current?.value || "").trim() ||
      "What is the main object visible in the camera?";

    lock.current = true;
    setLiveAnswer("Analyzing camera image...");

    try {
      const canvas = document.createElement("canvas");

      // Preserve more visual detail for product and phone identification.
      const captureWidth = Math.min(video.videoWidth, 1280);
      canvas.width = captureWidth;
      canvas.height = Math.round(
        captureWidth * video.videoHeight / video.videoWidth
      );

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Unable to capture camera frame.");
      }

      context.drawImage(
        video,
        0,
        0,
        canvas.width,
        canvas.height
      );

      const focusedQuestion = [
        "Answer the user's exact question and nothing else.",
        "Use the attached camera image as visual evidence only when relevant.",
        "Do not automatically describe the entire image.",
        "Do not add unrelated observations or explanations.",
        "If asked to identify a phone or product, inspect distinguishing physical details carefully.",
        "For a phone, inspect the number and arrangement of rear cameras, lens positions, flash position, LiDAR sensor if visible, camera bump shape, body edges, buttons, ports, screen design and proportions.",
        "Compare the visible details with known product generations. Do not identify an exact model using only the brand or colour.",
        "If the image clearly supports an exact model, give the model name and briefly state the visible evidence.",
        "If similar models cannot be distinguished from this camera angle, say so and ask for a clear rear view or another angle.",
        "Never invent hidden specifications or claim certainty without visible evidence.",
        "If the answer cannot be determined from the image, say so briefly.",
        "Reply in the language used by the user. Keep the answer direct and concise, normally one or two sentences.",
        "",
        "User's question: " + userQuestion
      ].join("\n");

      const data = await request(
        "/api/vision",
        json({
          image: canvas.toDataURL("image/jpeg", 0.9),
          question: focusedQuestion
        })
      );

      const answer = data.answer || "I couldn't get an answer.";
      setLiveAnswer(answer);

      if (
        speakAnswer &&
        voiceModeRef.current &&
        "speechSynthesis" in window
      ) {
        window.speechSynthesis.cancel();

        const utterance = createAURIXUtterance(answer);

        utterance.onend = () => {
          if (voiceModeRef.current) {
            recognitionRestartRef.current = window.setTimeout(
              listenForNextQuestion,
              500
            );
          }
        };

        utterance.onerror = () => {
          if (voiceModeRef.current) {
            recognitionRestartRef.current = window.setTimeout(
              listenForNextQuestion,
              800
            );
          }
        };

        window.speechSynthesis.speak(utterance);
      }
    } catch (err) {
      setError(err.message);
      setLiveAnswer("I couldn't answer that. Please try again.");

      if (speakAnswer && voiceModeRef.current) {
        recognitionRestartRef.current = window.setTimeout(
          listenForNextQuestion,
          1200
        );
      }
    } finally {
      lock.current = false;
    }
  }

  return (
    <div className={dark ? "app" : "app light"}>

      {/* SIDEBAR */}
      <aside className={"sidebar " + (side ? "visible" : "")}>
        <div className="brand">
          <img src="/icon.png" alt="AURIX AI" />

          <div>
            <b>AURIX AI</b>
            <small>Intelligence Beyond Limits</small>
          </div>

          <button className="mobile" onClick={() => setSide(false)}>
            <X size={20} />
          </button>
        </div>

        <button className="new" onClick={newChat}>
          <Plus size={18} />
          New conversation
        </button>

        <div className="history">
          <p>YOUR CONVERSATIONS</p>

          {chats.map((chat) => (
            <div
              className={
                "history-item " + (chat.id === id ? "active" : "")
              }
              key={chat.id}
            >
              <button
                onClick={() => {
                  setId(chat.id);
                  setMode("chat");
                  setSide(false);
                }}
              >
                <MessageSquare size={15} />
                <span>{chat.title}</span>
              </button>

              <button
                className="delete"
                onClick={() => removeChat(chat.id)}
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="side-foot">
          AURIX AI · v1.0
          <br />
          Private local chat storage
        </div>
      </aside>

      {side && (
        <div
          className="overlay"
          onClick={() => setSide(false)}
        />
      )}

      {/* MAIN */}
      <main>
        <header>
          <div className="header-left">
            <button className="mobile" onClick={() => setSide(true)}>
              <Menu />
            </button>

            <div className="orb">✦</div>

            <div>
              <strong>AURIX AI</strong>
              <small>Your intelligent companion</small>
            </div>
          </div>

          <div className="header-actions">
            <button
              title="Theme"
              onClick={() => setDark((value) => !value)}
            >
              {dark ? <Sun size={19} /> : <Moon size={19} />}
            </button>

            <button
              title="Image search"
              onClick={() => {
                setMode(mode === "search" ? "chat" : "search");
                setError("");
              }}
            >
              <Search size={19} />
            </button>

            <button
              title="Live vision"
              onClick={() => {
                setMode("chat");
                startLive();
              }}
            >
              <Camera size={19} />
            </button>
          </div>
        </header>

        {/* IMAGE SEARCH */}
        {mode === "search" ? (
          <section className="search-panel">
            <div className="search-title">
              <h2>Explore Images</h2>
              <p>Search Wikimedia Commons images</p>
            </div>

            <div className="search-form">
              <input
                placeholder="Search images, e.g. nebula galaxy"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) =>
                  event.key === "Enter" && searchImages()
                }
              />

              <button onClick={searchImages} disabled={busy}>
                <Search size={18} />
                Search
              </button>
            </div>

            <div className="image-grid">
              {results.map((result, index) => (
                <a
                  href={result.page}
                  target="_blank"
                  rel="noreferrer"
                  key={index}
                >
                  <img
                    src={result.url}
                    loading="lazy"
                    alt={result.title}
                  />
                  <span>{result.title}</span>
                </a>
              ))}
            </div>

            <p className="provider">
              Image sources: Wikimedia Commons.
              Verify licensing before reuse.
            </p>
          </section>
        ) : (
          <>
            {/* MESSAGES */}
            <section className="messages">
              {!current?.messages?.length ? (
                <div className="welcome">
                  <img src="/icon.png" alt="AURIX AI" />

                  <h1>How can I help you today?</h1>

                  <p>
                    Chat, explore images, speak, or show me what you see.
                  </p>

                  <div className="suggestions">
                    {[
                      "Explain machine learning simply",
                      "Help me write Java code",
                      "Analyze an uploaded photo",
                      "Brainstorm a startup idea"
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => setInput(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="conversation">
                  {current.messages.map((message) => (
                    <div
                      className={"message " + message.role}
                      key={message.id}
                    >
                      <div className="avatar">
                        {message.role === "assistant" ? "✦" : "You"}
                      </div>

                      <div className="bubble">
                        {message.image && (
                          <img
                            className="uploaded"
                            src={message.image}
                            alt="Uploaded"
                          />
                        )}

                        <div className="msg-text">
                          {message.text}
                        </div>

                        {message.role === "assistant" && (
                          <div className="msg-actions">
                            <button
                              onClick={() =>
                                navigator.clipboard.writeText(message.text || "")
                              }
                            >
                              Copy
                            </button>

                            <button
                              onClick={() => speak(message.text || "")}
                            >
                              <Volume2 size={15} />
                              Listen
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {busy && (
                    <div className="thinking">
                      <LoaderCircle size={17} className="spin" />
                      AURIX is thinking...
                    </div>
                  )}
                </div>
              )}

              <div ref={bottom} />
            </section>

            {/* COMPOSER */}
            <div className="composer-area">
              {error && (
                <div className="error">
                  {error}
                  <button onClick={() => setError("")}>×</button>
                </div>
              )}

              {image && (
                <div className="image-preview">
                  <img src={image} alt="Preview" />

                  <button onClick={() => setImage(null)}>
                    <X size={15} />
                  </button>
                </div>
              )}

              <div className="composer">
                <button
                  title="Upload image"
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus size={21} />
                </button>

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  onChange={attach}
                />

                <textarea
                  rows="1"
                  placeholder="Message AURIX AI..."
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      send();
                    }
                  }}
                />

                <button
                  title={recording ? "Stop recording" : "Voice input"}
                  className={recording ? "recording" : ""}
                  onClick={toggleRecording}
                >
                  {recording ? <MicOff size={21} /> : <Mic size={21} />}
                </button>

                <button
                  className="send"
                  disabled={busy || (!input.trim() && !image)}
                  onClick={send}
                >
                  <Send size={19} />
                </button>
              </div>

              <small>
                AI may make mistakes. Verify important information.
              </small>
            </div>
          </>
        )}
      </main>

      {/* LIVE VISION */}
      {live && (
        <div className="live-modal">
          <div className="live-top">
            <div>
              <b>✦ AURIX Live Vision</b>
              <small>Camera snapshots + AI analysis</small>
            </div>

            <button onClick={stopLive}>
              <X />
            </button>
          </div>

          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            disablePictureInPicture
          />

          <div className="live-bottom">
            <input
              ref={liveQuestionRef}
              placeholder="Ask about what the camera sees..."
            />

            <button onClick={analyzeFrame} disabled={busy}>
              <Camera size={18} />
              Analyze
            </button>

            <button
              className={voiceConversation ? "recording" : ""}
              onClick={
                voiceConversation
                  ? stopVoiceConversation
                  : startVoiceConversation
              }
              title={
                voiceConversation
                  ? "Stop voice conversation"
                  : "Start voice conversation"
              }
            >
              {voiceConversation ? <MicOff /> : <Mic />}
              {voiceConversation ? "Stop Voice" : "Talk"}
            </button>

            <button onClick={toggleRecording}>
              {recording ? <MicOff /> : <Mic />}
            </button>

            <p>{liveAnswer}</p>

            <button className="end-live" onClick={stopLive}>
              <Square size={16} />
              End Live
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// APP ENTRY POINT
createRoot(document.getElementById("root")).render(<App />);
