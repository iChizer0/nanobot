import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { NanobotFeatureInfo } from "@/lib/types";
import {
  installSettingsViewTestHooks,
  jsonResponse,
  renderSettingsView,
  requestMutationMock,
  settingsPayload,
} from "@/tests/settings-test-utils";

installSettingsViewTestHooks();

const PATCH_KEY = "channels.voice.importJson";

function voiceFeature(overrides: Partial<NanobotFeatureInfo> = {}): NanobotFeatureInfo {
  return {
    name: "voice",
    display_name: "Voice",
    type: "channel",
    enabled: false,
    installed: true,
    ready: false,
    status: "not_enabled",
    install_supported: true,
    requires_restart: true,
    requires_dependencies: true,
    webui: "webui/index.tsx",
    setup: {
      fields: [{
        key: PATCH_KEY,
        field: "importJson",
        kind: "json",
        choices: [],
        required: true,
      }],
      requirements: [],
    },
    ...overrides,
  };
}

function form(backend: string) {
  const sections = [{
    id: "backend",
    label: "Backend",
    fields: [{
      key: "backend",
      kind: "enum",
      label: "Backend",
      help: "Local runs on this machine.",
      choices: [{ value: "local", label: "Local" }, { value: "openai", label: "OpenAI" }],
      value: backend,
    }],
  }];
  if (backend === "local") {
    sections.push({
      id: "audio",
      label: "Audio",
      fields: [{
        key: "audio.captureDevice",
        kind: "string",
        label: "Microphone",
        help: "An ALSA PCM name such as `plughw:1,0`.",
        value: "default",
      }, {
        key: "audio.aecTail",
        kind: "bool",
        label: "Echo tail",
        help: "Keep the echo canceller's tail across turns.",
        value: false,
      }, {
        key: "vad.hangoverMs",
        kind: "int",
        label: "End of speech",
        unit: "ms",
        help: "Silence after speech that ends the turn.",
        value: 600,
      }, {
        key: "audio.backend",
        kind: "enum",
        label: "Audio backend",
        choices: [{ value: "alsa", label: "ALSA" }, { value: "null", label: "None" }],
        value: "alsa",
        advanced: true,
      }] as never,
    }, {
      id: "tts",
      label: "Text-to-speech",
      fields: [{
        key: "tts.matcha.speed",
        kind: "float",
        label: "Speed",
        help: "1 is the voice's own pace. Higher speaks faster.",
        value: 1.05,
        advanced: true,
      }] as never,
    }, {
      id: "interruptions",
      label: "Interruptions",
      fields: [{
        key: "duckDb",
        kind: "float",
        label: "Duck level",
        unit: "dB",
        signed: true,
        value: -12,
        advanced: true,
      }] as never,
    }, {
      id: "waiting",
      label: "Waiting",
      fields: [{
        key: "agentTimeoutS",
        kind: "float",
        label: "Agent timeout",
        unit: "s",
        help: "Empty turns the watch off.",
        optional: true,
        value: 300,
        advanced: true,
      }] as never,
    }, {
      id: "access",
      label: "Access",
      fields: [{
        key: "allowFrom",
        kind: "list",
        label: "Allowed senders",
        value: ["*"],
        advanced: true,
      }, {
        key: "logTranscripts",
        kind: "bool",
        label: "Log transcripts",
        value: false,
        advanced: true,
      }] as never,
    });
  } else {
    sections.push({
      id: "provider",
      label: "Provider",
      fields: [{
        key: "realtime.apiKey",
        kind: "secret",
        label: "API key",
        configured: false,
      }] as never,
    }, {
      id: "vad",
      label: "Listening",
      advanced: true,
      note: "Not in use until Send audio is On speech or After wake word.",
      fields: [{
        key: "vad.engine",
        kind: "enum",
        label: "Voice activity detector",
        choices: [{ value: "energy", label: "Energy" }, { value: "silero", label: "Silero" }],
        value: "energy",
      }] as never,
    } as never);
  }
  return { sections };
}

function validation(backend: string, overrides: Record<string, unknown> = {}) {
  return {
    name: "voice",
    status: "configured",
    checks: [
      { id: "schema", label: "Voice configuration", status: "pass" },
      { id: "audio_devices", label: "Audio devices", status: "skipped", message: "probed at start" },
    ],
    identity: { name: "Voice", workspace: `${backend}: energy, nanobot, openai` },
    missing_fields: [],
    can_enable: true,
    requires_restart: false,
    message: "Configuration is present, but full verification was not possible.",
    form: form(backend),
    ...overrides,
  };
}

function stubFeatures(feature: () => NanobotFeatureInfo) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/settings") return jsonResponse(settingsPayload());
    if (url === "/api/settings/nanobot-features") {
      return jsonResponse({ features: [feature()], enabled_count: 0 });
    }
    return jsonResponse({});
  }));
}

function connectCalls(action: "start" | "poll" | "cancel") {
  return requestMutationMock.mock.calls.filter(([name]) => name === `settings.channel.connect.${action}`);
}

function validateCalls() {
  return requestMutationMock.mock.calls.filter(([action]) => action === "settings.channel.validate");
}

function configureCalls() {
  return requestMutationMock.mock.calls.filter(([action]) => action === "settings.channel.configure");
}

it("renders the validator's form and writes edits as one pending patch", async () => {
  let current = voiceFeature();
  stubFeatures(() => current);
  requestMutationMock.mockImplementation(async (action: string, payload: { values?: Record<string, string> }) => {
    if (action === "settings.channel.validate") {
      const patch = JSON.parse(payload.values?.[PATCH_KEY] ?? "{}") as { backend?: string };
      return validation(patch.backend ?? "local");
    }
    if (action === "settings.channel.configure") {
      current = voiceFeature({
        config_values: { [PATCH_KEY]: JSON.stringify(JSON.parse(payload.values![PATCH_KEY]), null, 2) },
        configured_fields: [PATCH_KEY],
      });
      return { name: "voice", saved: true, saved_keys: [PATCH_KEY], nanobot_features: { features: [current], enabled_count: 0 } };
    }
    return settingsPayload();
  });

  renderSettingsView({ initialSection: "channels" });
  fireEvent.click(await screen.findByRole("button", { name: "View Voice settings" }));

  // The form is the validator's, shaped by the section: local shows the microphone.
  const microphone = await screen.findByLabelText("Microphone");
  // Help reads as prose with typed literals set as code; options show their labels, not values.
  const help = screen.getByText("An ALSA PCM name such as", { exact: false });
  expect(help.querySelector("code")).toHaveTextContent("plughw:1,0");
  expect(help).toHaveTextContent("An ALSA PCM name such as plughw:1,0.");
  expect(screen.getByLabelText("OpenAI")).toHaveAttribute("value", "openai");
  expect(screen.queryByLabelText("openai")).toBeNull();
  expect(screen.getAllByRole("group", { name: "Backend" })).toHaveLength(2); // section + its radio group
  expect(validateCalls()).toHaveLength(1);
  // the patch is sent even when empty: `{}` withdraws a saved paste, where sending nothing
  // would leave it in force and check a section the panel is no longer showing
  expect(validateCalls()[0][1]).toEqual({ name: "voice", values: { [PATCH_KEY]: "{}" } });
  expect(screen.queryByRole("button", { name: "Check connection" })).toBeNull();
  // A boolean is a switch, not an On/Off pair; it writes the boolean and reads its state.
  const echoTail = screen.getByRole("switch", { name: "Echo tail" });
  expect(echoTail).not.toBeChecked();
  expect(screen.queryByLabelText("On")).toBeNull();
  fireEvent.click(echoTail);
  await waitFor(() => expect(validateCalls()).toHaveLength(2));
  expect(validateCalls()[1][1]).toEqual({ name: "voice", values: { [PATCH_KEY]: '{"audio":{"aecTail":true}}' } });
  expect(screen.getByRole("switch", { name: "Echo tail" })).toBeChecked();
  fireEvent.click(screen.getByRole("switch", { name: "Echo tail" }));
  await waitFor(() => expect(validateCalls()).toHaveLength(3));
  expect(validateCalls()[2][1]).toEqual({ name: "voice", values: { [PATCH_KEY]: '{"audio":{"aecTail":false}}' } });

  // A number with a unit: the unit sits in the input, the label stays the quantity, the
  // value is written as a number.
  const hangover = screen.getByLabelText("End of speech");
  expect(hangover).toHaveValue("600");
  expect(hangover.parentElement).toHaveTextContent("ms");
  fireEvent.change(hangover, { target: { value: "800" } });
  await waitFor(() => expect(validateCalls()).toHaveLength(4));
  expect(validateCalls()[3][1]).toEqual({ name: "voice", values: { [PATCH_KEY]: '{"audio":{"aecTail":false},"vad":{"hangoverMs":800}}' } });

  // Switching the backend re-asks with the patch, and the fields follow. A section the
  // setup does not use is not shown, until Advanced, with its note.
  fireEvent.click(screen.getByLabelText("OpenAI"));
  await waitFor(() => expect(validateCalls()).toHaveLength(5));
  expect(validateCalls()[4][1]).toEqual({ name: "voice", values: { [PATCH_KEY]: '{"audio":{"aecTail":false},"vad":{"hangoverMs":800},"backend":"openai"}' } });
  expect(await screen.findByLabelText("API key")).toBeInTheDocument();
  expect(screen.queryByLabelText("Microphone")).toBeNull();
  expect(microphone).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Listening" })).toBeNull();

  // ...and autosave writes exactly that patch through the manifest's json field.
  await waitFor(() => expect(configureCalls()).toHaveLength(1));
  expect(configureCalls()[0][1]).toEqual({ name: "voice", values: { [PATCH_KEY]: '{"audio":{"aecTail":false},"vad":{"hangoverMs":800},"backend":"openai"}' } });
  expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
  expect(screen.getByText("Pending changes apply when the channel starts.")).toBeInTheDocument();

  // Advanced opens the config import right under its toggle, ahead of the (long) form,
  // showing the pending edits as the keys they set.
  const advanced = screen.getByRole("button", { name: "Advanced" });
  const importBox = screen.getByLabelText("Config import");
  expect(importBox).not.toBeVisible();
  fireEvent.click(advanced);
  expect(importBox).toBeVisible();
  expect(importBox).toHaveValue(JSON.stringify({ audio: { aecTail: false }, vad: { hangoverMs: 800 }, backend: "openai" }, null, 2));
  const firstSection = screen.getAllByRole("group", { name: "Backend" })[0];
  expect(importBox.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const listening = screen.getByRole("group", { name: "Listening" });
  expect(listening).toHaveTextContent("Not in use until Send audio is On speech or After wake word.");
  expect(within(listening).getByLabelText("Energy")).toBeChecked();
  fireEvent.click(advanced);
  expect(importBox).not.toBeVisible();
  expect(screen.queryByRole("group", { name: "Listening" })).toBeNull();

  // Reset is a pending patch of its own: the directive alone, then edits on top of it;
  // Discard withdraws it like any patch.
  fireEvent.click(screen.getByLabelText("Local"));
  await waitFor(() => expect(screen.queryByLabelText("Microphone")).not.toBeNull());
  fireEvent.click(advanced);
  const reset = screen.getByRole("button", { name: "Reset to defaults" });
  fireEvent.click(reset);
  await waitFor(() => expect(validateCalls().at(-1)?.[1]).toEqual({ name: "voice", values: { [PATCH_KEY]: '{"$reset":true}' } }));
  expect(importBox).toHaveValue(JSON.stringify({ $reset: true }, null, 2));
  expect(reset).toBeDisabled();
  fireEvent.click(screen.getByRole("switch", { name: "Echo tail" }));
  await waitFor(() => expect(validateCalls().at(-1)?.[1]).toEqual({ name: "voice", values: { [PATCH_KEY]: '{"$reset":true,"audio":{"aecTail":true}}' } }));
  expect(reset).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Discard pending changes" }));
  // `{}` and not nothing: the saved paste is withdrawn, so the rows and rows below check
  // the section as it will be, not as the discarded patch left it
  await waitFor(() => expect(validateCalls().at(-1)?.[1]).toEqual({ name: "voice", values: { [PATCH_KEY]: "{}" } }));

  // The rows the validator marks advanced show in place only while Advanced is open,
  // shaded as a block where they sit (the plain rows around them are not), with a line
  // in the Advanced area saying so; a section made of them alone goes with them.
  expect(screen.getByLabelText("ALSA")).toBeChecked();
  expect(screen.getByRole("switch", { name: "Log transcripts" })).toBeInTheDocument();
  expect(screen.getByText("The less common rows and sections open in place below, shaded.")).toBeVisible();
  expect(screen.getByLabelText("ALSA").closest(".bg-foreground\\/\\[0\\.06\\]")).not.toBeNull();
  expect(screen.getByLabelText("Microphone").closest(".bg-foreground\\/\\[0\\.06\\]")).toBeNull();
  expect(screen.getByRole("switch", { name: "Log transcripts" }).closest(".bg-foreground\\/\\[0\\.06\\]")).not.toBeNull();
  fireEvent.click(advanced);
  expect(screen.queryByLabelText("ALSA")).toBeNull();
  expect(screen.queryByRole("switch", { name: "Log transcripts" })).toBeNull();
  expect(screen.queryByRole("group", { name: "Access" })).toBeNull();
  expect(screen.getByLabelText("Microphone")).toBeInTheDocument();

  // An emptied input withdraws the edit where the schema has no empty (the row shows its
  // resolved value again), and writes the empty where it has one: null for an optional
  // row, no items for a list. No placeholder stands in for either.
  fireEvent.change(screen.getByLabelText("End of speech"), { target: { value: "" } });
  await waitFor(() => expect(validateCalls().at(-1)?.[1]).toEqual({ name: "voice", values: { [PATCH_KEY]: "{}" } }));
  expect(screen.getByLabelText("End of speech")).toHaveValue(""); // still being typed into
  fireEvent.blur(screen.getByLabelText("End of speech"));
  expect(screen.getByLabelText("End of speech")).toHaveValue("600"); // left: the resolved value
  fireEvent.click(advanced);
  const timeout = screen.getByLabelText("Agent timeout");
  expect(timeout).toHaveValue("300");
  fireEvent.change(timeout, { target: { value: "" } });
  await waitFor(() => expect(validateCalls().at(-1)?.[1]).toEqual({ name: "voice", values: { [PATCH_KEY]: '{"agentTimeoutS":null}' } }));
  expect(timeout).toHaveValue("");
  expect(timeout).not.toHaveAttribute("placeholder");
  fireEvent.change(screen.getByLabelText("Allowed senders"), { target: { value: "" } });
  await waitFor(() => expect(validateCalls().at(-1)?.[1]).toEqual({ name: "voice", values: { [PATCH_KEY]: '{"agentTimeoutS":null,"allowFrom":[]}' } }));
});

it("keeps a list row's typed text and takes a whole section pasted into Config import", async () => {
  // Two ends of the same rule: what the row shows is what was typed, until the row is
  // left; and what the box takes is the section the plugin reads out of a paste, so a
  // later row edit lands in the same object rather than beside the wrapper it dropped.
  stubFeatures(() => voiceFeature());
  requestMutationMock.mockImplementation(async (action: string) => (
    action === "settings.channel.validate" ? validation("local") : settingsPayload()
  ));
  renderSettingsView({ initialSection: "channels" });
  fireEvent.click(await screen.findByRole("button", { name: "View Voice settings" }));
  await screen.findByLabelText("Microphone");
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));

  // typed key by key: the separator and the space survive, each keystroke writing items
  const senders = screen.getByLabelText("Allowed senders");
  for (const text of ["local", "local,", "local, ", "local, ops"]) {
    fireEvent.change(senders, { target: { value: text } });
    expect(senders).toHaveValue(text);
  }
  await waitFor(() => expect(validateCalls().at(-1)?.[1]).toEqual({
    name: "voice", values: { [PATCH_KEY]: '{"allowFrom":["local","ops"]}' },
  }));
  fireEvent.blur(senders);
  expect(senders).toHaveValue("local, ops"); // left: the value it wrote, formatted

  // a config file pasted whole: the section comes out of its wrapper, so the pill below
  // writes into the same patch (the plugin would drop anything left beside it)
  const importBox = screen.getByLabelText("Config import");
  fireEvent.change(importBox, {
    target: { value: JSON.stringify({ channels: { voice: { enabled: true, aec: "soft", importJson: "" } } }) },
  });
  await waitFor(() => expect(validateCalls().at(-1)?.[1]).toEqual({
    name: "voice", values: { [PATCH_KEY]: '{"aec":"soft"}' },
  }));
  fireEvent.click(screen.getByLabelText("OpenAI"));
  await waitFor(() => expect(validateCalls().at(-1)?.[1]).toEqual({
    name: "voice", values: { [PATCH_KEY]: '{"aec":"soft","backend":"openai"}' },
  }));
});

it("settles a run that finished while the panel was closed", async () => {
  // The download goes on in the gateway; the panel that reopens asks for a plan and is
  // handed the run's result instead, which is the "succeeded" core starts the channel on.
  let current = voiceFeature();
  stubFeatures(() => current);
  requestMutationMock.mockImplementation(async (action: string, payload: { plan?: boolean }) => {
    if (action === "settings.channel.validate") return validation("local");
    if (action === "settings.channel.connect.start" && payload.plan) {
      if (connectCalls("start").length <= 1) {
        current = voiceFeature({ enabled: true, runtime_status: "starting" });
        return {
          session_id: "s9", status: "succeeded", message: "Models fetched 1 (75 MB).",
          nanobot_features: { features: [current], enabled_count: 1 },
        };
      }
      return {
        session_id: "", status: "planned", index: { cached_unix: 1, refreshing: false, error: null },
        plan: { fetch: [], prune: [], unknown: [], fetch_bytes: 0, prune_bytes: 0, free_bytes: 1 },
      };
    }
    return settingsPayload();
  });
  renderSettingsView({ initialSection: "channels" });
  fireEvent.click(await screen.findByRole("button", { name: "View Voice settings" }));
  await screen.findByLabelText("Microphone");
  // the result is taken once, and the panel then reads the plan it was hiding
  await waitFor(() => expect(connectCalls("start").length).toBeGreaterThanOrEqual(2));
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(connectCalls("start").length).toBeLessThanOrEqual(3);
  expect(screen.queryByText("Models fetched 1 (75 MB).")).toBeNull(); // not an error: a result
});

it("opens on the form first and follows the index reload behind the plan", async () => {
  // Core answers a socket's requests one at a time, so the form's request goes out
  // before the plan's; the reload runs behind the plan's answer, the panel polls while
  // it does, and re-asks for the form once it lands (the Model pills come from the cache).
  stubFeatures(() => voiceFeature());
  let plans = 0;
  requestMutationMock.mockImplementation(async (action: string, payload: { plan?: boolean; refresh?: boolean }) => {
    if (action === "settings.channel.validate") return validation("local");
    if (action === "settings.channel.connect.start" && payload.plan) {
      plans += 1;
      return {
        session_id: "", status: "planned",
        index: { cached_unix: plans < 3 ? 1 : 2, refreshing: plans < 3, error: null },
        plan: { fetch: [], prune: [], unknown: [], fetch_bytes: 0, prune_bytes: 0, free_bytes: 1 },
      };
    }
    return settingsPayload();
  });
  renderSettingsView({ initialSection: "channels" });
  fireEvent.click(await screen.findByRole("button", { name: "View Voice settings" }));
  await screen.findByLabelText("Microphone");
  const actions = requestMutationMock.mock.calls.map(([action]) => action as string);
  expect(actions.indexOf("settings.channel.validate")).toBeLessThan(actions.indexOf("settings.channel.connect.start"));
  expect(connectCalls("start")[0][1]).toEqual({ channel: "voice", plan: true, refresh: true });
  // two polls while the reload runs (no refresh asked again), then the form re-asked
  await waitFor(() => expect(connectCalls("start")).toHaveLength(3), { timeout: 4000 });
  expect(connectCalls("start")[1][1]).toEqual({ channel: "voice", plan: true });
  expect(connectCalls("start")[2][1]).toEqual({ channel: "voice", plan: true });
  await waitFor(() => expect(validateCalls()).toHaveLength(2));
  await new Promise((resolve) => setTimeout(resolve, 1200));
  expect(connectCalls("start")).toHaveLength(3); // landed: no more polls
});

it("re-asks for the form only when a reload moved the cache from what it was before", async () => {
  // The Model pills come from the cache, so a reload that changed nothing is not worth a
  // second validate on a socket core answers one request at a time. The open's reload
  // has no age before it (the form was asked for first), so that one re-asks; a later
  // one that leaves the cache as it was does not.
  stubFeatures(() => voiceFeature());
  let plans = 0;
  requestMutationMock.mockImplementation(async (action: string, payload: { plan?: boolean }) => {
    if (action === "settings.channel.validate") return validation("local");
    if (action === "settings.channel.configure") return { name: "voice", saved: true, saved_keys: [PATCH_KEY] };
    if (action === "settings.channel.connect.start" && payload.plan) {
      plans += 1;
      return {
        session_id: "", status: "planned",
        index: { cached_unix: 7, refreshing: plans === 1 || plans === 3, error: null },
        plan: { fetch: [], prune: [], unknown: [], fetch_bytes: 0, prune_bytes: 0, free_bytes: 1 },
      };
    }
    return settingsPayload();
  });
  renderSettingsView({ initialSection: "channels" });
  fireEvent.click(await screen.findByRole("button", { name: "View Voice settings" }));
  await screen.findByLabelText("Microphone");
  await waitFor(() => expect(connectCalls("start")).toHaveLength(2), { timeout: 4000 });
  await waitFor(() => expect(validateCalls()).toHaveLength(2));
  // an edit: its own validate, then the save's plan finds the gateway reloading
  fireEvent.change(screen.getByLabelText("Microphone"), { target: { value: "plughw:1,0" } });
  await waitFor(() => expect(connectCalls("start")).toHaveLength(4), { timeout: 4000 });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  expect(validateCalls()).toHaveLength(3);
  expect(connectCalls("start")).toHaveLength(4); // landed: no more polls
});

it("follows a reload the gateway starts itself, even one its first answer already saw land", async () => {
  // A saved section naming another index makes the gateway reload on its own; the panel
  // polls it like one it asked for and re-asks for the form once it lands. The answer
  // that says it started can already carry the new cache (it ran behind that very plan),
  // so the reload is measured against the age from before it.
  stubFeatures(() => voiceFeature());
  let plans = 0;
  let reloaded = false;
  requestMutationMock.mockImplementation(async (action: string, payload: { plan?: boolean }) => {
    if (action === "settings.channel.validate") {
      const base = validation("local");
      const [general, ...rest] = base.form.sections;
      const help = reloaded ? "Pills from the index just loaded." : general.fields[0].help;
      return { ...base, form: { sections: [{ ...general, fields: [{ ...general.fields[0], help }] }, ...rest] } };
    }
    if (action === "settings.channel.configure") return { name: "voice", saved: true, saved_keys: [PATCH_KEY] };
    if (action === "settings.channel.connect.start" && payload.plan) {
      plans += 1;
      if (plans === 2) reloaded = true; // the save's plan: the reload ran behind it and landed
      return {
        session_id: "", status: "planned",
        index: { cached_unix: plans === 1 ? 1 : 2, refreshing: plans === 2, error: null },
        plan: { fetch: [], prune: [], unknown: [], fetch_bytes: 0, prune_bytes: 0, free_bytes: 1 },
      };
    }
    return settingsPayload();
  });
  renderSettingsView({ initialSection: "channels" });
  fireEvent.click(await screen.findByRole("button", { name: "View Voice settings" }));
  await screen.findByLabelText("Microphone");
  await waitFor(() => expect(validateCalls()).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Microphone"), { target: { value: "plughw:1,0" } });
  expect(await screen.findByText("Pills from the index just loaded.", {}, { timeout: 4000 })).toBeInTheDocument();
  expect(connectCalls("start")[1][1]).toEqual({ channel: "voice", plan: true }); // the gateway's own
  expect(connectCalls("start")).toHaveLength(3);
});

it("stops waiting when the validator answers without a form", async () => {
  // A refusal whose lenient shaping also failed, or a validator that raised: the answer
  // has arrived, so the panel must not spin on a form that is never coming.
  stubFeatures(() => voiceFeature());
  requestMutationMock.mockImplementation(async (action: string) => (
    action === "settings.channel.validate"
      ? { name: "voice", status: "invalid", can_enable: false, checks: [], message: "config.json is not readable" }
      : settingsPayload()
  ));
  renderSettingsView({ initialSection: "channels" });
  fireEvent.click(await screen.findByRole("button", { name: "View Voice settings" }));
  await screen.findByRole("button", { name: "Advanced" });
  await waitFor(() => expect(screen.queryByText("Loading")).toBeNull());
});

it("takes any value on a float row and whole numbers on an int row", async () => {
  // Every number is the panel's own row: a float takes any value (else the browser steps
  // and validates it as an integer) with a decimal keypad, an int stays whole.
  stubFeatures(() => voiceFeature());
  requestMutationMock.mockImplementation(async (action: string) => (
    action === "settings.channel.validate" ? validation("local") : settingsPayload()
  ));
  renderSettingsView({ initialSection: "channels" });
  fireEvent.click(await screen.findByRole("button", { name: "View Voice settings" }));
  // text inputs with a numeric keypad, not type=number: the browser sanitises a partly
  // typed number ("-", "0.") to "", which this controlled input would write back
  const hangover = await screen.findByLabelText("End of speech");
  expect(hangover).toHaveAttribute("type", "text");
  expect(hangover).toHaveAttribute("inputmode", "numeric");
  fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
  const speed = screen.getByLabelText("Speed");
  expect(speed).toHaveAttribute("inputmode", "decimal");
  expect(speed).toHaveValue("1.05");
  fireEvent.change(speed, { target: { value: "1.2" } });
  await waitFor(() => expect(validateCalls().at(-1)?.[1]).toEqual({ name: "voice", values: { [PATCH_KEY]: '{"tts":{"matcha":{"speed":1.2}}}' } }));
  expect(speed).toHaveValue("1.2");

  // typed key by key: the row keeps the text it was given until it is left, so a decimal
  // point (or a cleared field, or a minus) survives the round trip through the patch
  for (const text of ["", "0", "0.", "0.7"]) {
    fireEvent.change(speed, { target: { value: text } });
    expect(speed).toHaveValue(text);
  }
  await waitFor(() => expect(validateCalls().at(-1)?.[1]).toEqual({ name: "voice", values: { [PATCH_KEY]: '{"tts":{"matcha":{"speed":0.7}}}' } }));
  fireEvent.blur(speed);
  expect(speed).toHaveValue("0.7"); // left: the resolved value again, which is what it wrote
  // a signed row takes no numeric keypad at all: neither of them has a minus key
  const duck = screen.getByLabelText("Duck level");
  expect(duck).toHaveAttribute("inputmode", "text");
  fireEvent.change(duck, { target: { value: "-" } });
  expect(duck).toHaveValue("-");
  fireEvent.change(duck, { target: { value: "-6" } });
  await waitFor(() => expect(validateCalls().at(-1)?.[1]).toEqual({
    name: "voice", values: { [PATCH_KEY]: '{"tts":{"matcha":{"speed":0.7}},"duckDb":-6}' },
  }));
});

it("keeps the last form while a refused section explains itself", async () => {
  stubFeatures(() => voiceFeature());
  let refused = false;
  requestMutationMock.mockImplementation(async (action: string) => {
    if (action === "settings.channel.validate") {
      if (!refused) return validation("local");
      return {
        name: "voice",
        status: "invalid",
        checks: [{ id: "schema", label: "Voice configuration", status: "fail", message: "wake.mode=\"gate\" requires wake.phrases" }],
        identity: {},
        missing_fields: [],
        can_enable: false,
        requires_restart: false,
        message: "wake.mode=\"gate\" requires wake.phrases",
      };
    }
    return settingsPayload();
  });

  renderSettingsView({ initialSection: "channels" });
  fireEvent.click(await screen.findByRole("button", { name: "View Voice settings" }));
  const microphone = await screen.findByLabelText("Microphone");

  refused = true;
  fireEvent.change(microphone, { target: { value: "plughw:1,0" } });
  await waitFor(() => expect(validateCalls()).toHaveLength(2));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(await screen.findByText("wake.mode=\"gate\" requires wake.phrases")).toBeInTheDocument();
  // No form came back, so the fields (with the edit) are still there to fix it.
  expect(screen.getByLabelText("Microphone")).toHaveValue("plughw:1,0");
});


it("offers indexed models as pills and runs Apply through the connector with progress", async () => {
  let current = voiceFeature();
  stubFeatures(() => current);
  const whisper = {
    id: "stt",
    label: "Speech-to-text",
    fields: [{
      key: "stt.whisper.weights",
      kind: "weights",
      label: "Model",
      help: "Apply downloads the selected model. Custom takes any store key.",
      choices: [
        { value: "stt/whisper/base/rknn.rv1126b", label: "base", installed: false, bytes: 155_000_000, langs: ["en", "zh"],
          builds: [
            { value: "stt/whisper/base/onnx", label: "CPU", installed: false, bytes: 203_000_000, langs: ["en", "zh"] },
            { value: "stt/whisper/base/rknn.rv1126b", label: "RV1126B", installed: false, bytes: 155_000_000, langs: ["en", "zh"] },
          ] },
        { value: "stt/whisper/tiny/onnx", label: "tiny", installed: true, bytes: 75_000_000,
          license: "MIT", notice: "research only" },
      ],
    }],
  };
  const device = { key: "device", kind: "string", label: "Device",
    help: "The chip the on-device models are built for, empty for CPU builds only. The index has builds for `rv1126b`." };
  let selected: string | undefined;
  const polls: string[] = ["pending", "pending", "succeeded"];
  requestMutationMock.mockImplementation(async (action: string, payload: Record<string, unknown>) => {
    if (action === "settings.channel.validate") {
      const patch = JSON.parse((payload.values as Record<string, string>)?.[PATCH_KEY] ?? "{}") as { stt?: { whisper?: { weights?: string } } };
      selected = patch.stt?.whisper?.weights;
      const base = validation("local");
      return { ...base, form: { sections: [{ ...base.form.sections[0], fields: [...base.form.sections[0].fields, device as never] }, ...base.form.sections.slice(1), {
        ...whisper,
        fields: [{ ...whisper.fields[0], ...(selected ? { value: selected } : {}) }],
      }] } };
    }
    if (action === "settings.channel.configure") {
      current = voiceFeature({
        config_values: { [PATCH_KEY]: JSON.stringify(JSON.parse((payload.values as Record<string, string>)[PATCH_KEY])) },
        configured_fields: [PATCH_KEY],
      });
      return { name: "voice", saved: true, saved_keys: [PATCH_KEY], nanobot_features: { features: [current], enabled_count: 0 } };
    }
    if (action === "settings.channel.connect.start") {
      if (payload.plan) {
        return {
          session_id: "", status: "planned", index: { cached_unix: 1, refreshing: false, error: null },
          plan: selected === "stt/whisper/tiny/onnx"
            ? { fetch: [{ key: "stt/whisper/tiny/onnx", bytes: 75_000_000, license: "MIT", notice: "research only" }],
                prune: [{ key: "stt/whisper/base/onnx", bytes: 203_000_000 }], unknown: [],
                fetch_bytes: 75_000_000, prune_bytes: 203_000_000, free_bytes: 12_400_000_000 }
            : { fetch: [], prune: [], unknown: [], fetch_bytes: 0, prune_bytes: 0, free_bytes: 12_400_000_000 },
        };
      }
      return { session_id: "s1", status: "pending", interval_ms: 40,
        progress: { stage: "fetch", key: "stt/whisper/tiny/onnx", file: "encoder.onnx", done_bytes: 0, total_bytes: 75_000_000, keys_done: 0, keys_total: 1 } };
    }
    if (action === "settings.channel.connect.poll") {
      const status = polls.shift() ?? "succeeded";
      current = status === "succeeded" ? voiceFeature({ enabled: true, runtime_status: "starting" }) : current;
      return { session_id: "s1", status, interval_ms: 40, message: status === "succeeded" ? "Models fetched 1 (75 MB), removed 1 (203 MB)." : undefined,
        progress: { stage: status === "succeeded" ? "done" : "fetch", key: "stt/whisper/tiny/onnx", file: "encoder.onnx",
          done_bytes: status === "succeeded" ? 75_000_000 : 30_000_000, total_bytes: 75_000_000, keys_done: 0, keys_total: 1 },
        ...(status === "succeeded" ? { nanobot_features: { features: [current], enabled_count: 1 } } : {}) };
    }
    return settingsPayload();
  });

  renderSettingsView({ initialSection: "channels" });
  fireEvent.click(await screen.findByRole("button", { name: "View Voice settings" }));
  const group = await screen.findByRole("radiogroup", { name: "Model" });
  // pills carry the store state and the index's languages; nothing to apply while the
  // saved section names no model
  expect(group).toHaveTextContent("baseen, zh · 155 MB"); // the default build's size
  expect(group).toHaveTextContent("tinyinstalled");
  expect(screen.queryByRole("radiogroup", { name: "Model: Build" })).toBeNull();
  expect(screen.getByLabelText("Custom")).toBeInTheDocument();
  await waitFor(() => expect(connectCalls("start")).toHaveLength(1));
  expect(connectCalls("start")[0][1]).toEqual({ channel: "voice", plan: true, refresh: true }); // open: reload the index
  expect(screen.queryByRole("button", { name: /Apply|Fetch/ })).toBeNull();

  // the device is a typed name whose help lists the index's chips; clearing it withdraws the edit
  expect(screen.getByText("rv1126b")).toHaveClass("font-mono");
  fireEvent.change(screen.getByLabelText("Device"), { target: { value: "rv1126b" } });
  await waitFor(() => expect(configureCalls()).toHaveLength(1));
  expect(JSON.parse((configureCalls()[0][1] as { values: Record<string, string> }).values[PATCH_KEY])).toEqual({ device: "rv1126b" });
  fireEvent.change(screen.getByLabelText("Device"), { target: { value: "" } });
  await waitFor(() => expect(configureCalls()).toHaveLength(2));
  expect(JSON.parse((configureCalls()[1][1] as { values: Record<string, string> }).values[PATCH_KEY])).toEqual({});

  // a model in several builds: the pill picks the device build, the Build row under it
  // picks another, and the pill then describes that build
  fireEvent.click(screen.getByLabelText(/^base/));
  await waitFor(() => expect(configureCalls()).toHaveLength(3));
  expect(JSON.parse((configureCalls()[2][1] as { values: Record<string, string> }).values[PATCH_KEY])).toEqual({ stt: { whisper: { weights: "stt/whisper/base/rknn.rv1126b" } } });
  const builds = screen.getByRole("radiogroup", { name: "Model: Build" });
  expect(builds).toHaveTextContent("BuildCPUen, zh · 203 MBRV1126Ben, zh · 155 MB");
  expect(within(builds).getByLabelText(/^RV1126B/)).toBeChecked();
  fireEvent.click(within(builds).getByLabelText(/^CPU/));
  await waitFor(() => expect(configureCalls()).toHaveLength(4));
  expect(JSON.parse((configureCalls()[3][1] as { values: Record<string, string> }).values[PATCH_KEY])).toEqual({ stt: { whisper: { weights: "stt/whisper/base/onnx" } } });
  expect(screen.getByLabelText(/^base/)).toBeChecked();
  expect(group).toHaveTextContent("baseen, zh · 203 MB");

  // picking the noticed model: its license line shows under the row's help (which
  // stays), the saved plan lists the fetch and the removal, and Apply waits for the tick
  fireEvent.click(screen.getByLabelText(/^tiny/));
  const license = await screen.findByText("License: MIT. research only");
  const rowHelp = screen.getByText("Apply downloads the selected model. Custom takes any store key.");
  expect(license.compareDocumentPosition(rowHelp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await waitFor(() => expect(configureCalls()).toHaveLength(5));
  await waitFor(() => expect(connectCalls("start")).toHaveLength(6)); // one plan per save
  expect(connectCalls("start")[5][1]).toEqual({ channel: "voice", plan: true }); // after a save: the cache unless stale
  const apply = await screen.findByRole("button", { name: "Fetch 75 MB and start" });
  expect(apply).toBeDisabled();
  expect(screen.getByText(/Accept the notices above to apply\./)).toBeInTheDocument(); // why it waits
  expect(screen.getByText("stt/whisper/base/onnx")).toBeInTheDocument(); // to be removed
  fireEvent.click(screen.getByRole("checkbox"));
  expect(apply).toBeEnabled();
  expect(screen.queryByText(/Accept the notices above/)).toBeNull();

  // Apply: validate, start with the accepted key, poll to success, core's features land
  fireEvent.click(apply);
  await waitFor(() => expect(connectCalls("start")).toHaveLength(7));
  expect(connectCalls("start")[6][1]).toEqual({ channel: "voice", accept: "stt/whisper/tiny/onnx" });
  expect(await screen.findByText(/Fetching stt\/whisper\/tiny\/onnx · encoder.onnx · 30 MB \/ 75 MB/)).toBeInTheDocument();
  await waitFor(() => expect(connectCalls("poll").length).toBeGreaterThanOrEqual(3));
  await waitFor(() => expect(screen.queryByText(/Fetching/)).toBeNull());
  expect(screen.getByRole("switch", { name: "Enable channel" })).toBeChecked();
  expect(screen.queryByRole("button", { name: "Check connection" })).toBeNull();
});

const RUN_PROGRESS = { stage: "fetch", key: "tts/matcha/en-US/ljspeech/onnx", file: "decoder.onnx", done_bytes: 10_000_000, total_bytes: 26_000_000, keys_done: 0, keys_total: 1 };

/** A connector whose first plan finds a run still going; `polls` answers each poll in turn. */
// `intervalMs` paces the polls: a state asserted mid-run must outlast findByText's 50 ms sampling.
function stubRunInProgress(polls: (string | Error)[], feature: () => NanobotFeatureInfo, onSucceeded: () => void, intervalMs = 40) {
  requestMutationMock.mockImplementation(async (action: string, payload: Record<string, unknown>) => {
    if (action === "settings.channel.validate") return validation("local");
    if (action === "settings.channel.connect.start" && payload.plan) {
      if (polls.length) return { session_id: "s7", status: "pending", interval_ms: intervalMs, progress: RUN_PROGRESS };
      return { session_id: "", status: "planned", index: { cached_unix: 1, refreshing: false, error: null },
        plan: { fetch: [], prune: [], unknown: [], fetch_bytes: 0, prune_bytes: 0, free_bytes: 1e9 } };
    }
    if (action === "settings.channel.connect.poll") {
      const status = polls.shift() ?? "succeeded";
      if (status instanceof Error) throw status;
      if (status === "succeeded") onSucceeded();
      return { session_id: "s7", status, interval_ms: intervalMs, progress: { ...RUN_PROGRESS, done_bytes: 26_000_000 },
        ...(status === "succeeded" ? { nanobot_features: { features: [feature()], enabled_count: 1 } } : {}) };
    }
    return settingsPayload();
  });
}

it("picks up a run still going when reopened and follows it to the start", async () => {
  let current = voiceFeature();
  stubFeatures(() => current);
  stubRunInProgress(["pending", "succeeded"], () => current, () => {
    current = voiceFeature({ enabled: true, runtime_status: "starting" });
  }, 300);

  renderSettingsView({ initialSection: "channels" });
  fireEvent.click(await screen.findByRole("button", { name: "View Voice settings" }));
  // the run shows with its progress, the fields wait, and the poll that succeeds starts the channel
  expect(await screen.findByText(/Fetching tts\/matcha\/en-US\/ljspeech\/onnx · decoder.onnx · 10 MB \/ 26 MB/)).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "Enable channel" })).toBeDisabled();
  await waitFor(() => expect(screen.queryByText(/Fetching/)).toBeNull());
  expect(screen.getByRole("switch", { name: "Enable channel" })).toBeChecked();
  await waitFor(() => expect(connectCalls("start")).toHaveLength(2));
  expect(connectCalls("start")[1][1]).toEqual({ channel: "voice", plan: true }); // then the plan
});

it("lets go of a run the gateway no longer knows", async () => {
  stubFeatures(() => voiceFeature());
  stubRunInProgress([Object.assign(new Error("no such voice sync session"), { status: 404 })], voiceFeature, () => {});

  renderSettingsView({ initialSection: "channels" });
  fireEvent.click(await screen.findByRole("button", { name: "View Voice settings" }));
  // the run lasts one poll (too short to assert on); what remains is its reason, no run
  expect(await screen.findByText("no such voice sync session")).toBeInTheDocument();
  expect(screen.queryByText(/Fetching/)).toBeNull();
  expect(screen.getByRole("switch", { name: "Enable channel" })).toBeEnabled();
});

it("switches the wake tiers from the Model row and fills the phrases from a head", async () => {
  stubFeatures(() => voiceFeature());
  // the validator's view of the wake block, shaped from the patch as the plugin shapes it
  let wake: { engine?: string; phrases?: string[]; openwakeword?: { weights?: string | null; modelPath?: string } } = {};
  requestMutationMock.mockImplementation(async (action: string, payload: Record<string, unknown>) => {
    if (action === "settings.channel.validate") {
      wake = (JSON.parse((payload.values as Record<string, string>)?.[PATCH_KEY] ?? "{}") as { wake?: typeof wake }).wake ?? {};
      const acoustic = wake.engine === "openwakeword";
      const weights = acoustic ? wake.openwakeword?.weights : undefined;
      const phrases = wake.phrases ?? [];
      const model = { key: "wake.openwakeword.weights", kind: "weights", label: "Model",
        custom: "files", customOpen: acoustic && !weights, sets: { "wake.engine": "openwakeword" },
        help: "Transcript matches the phrase in the transcription. A head also hears its phrase in the audio and fills Phrases with it, Custom takes a head of your own.",
        choices: [
          { value: "", label: "Transcript", sets: { "wake.engine": "text" } },
          { value: "wake/openwakeword/alexa/onnx", label: "alexa", installed: false, bytes: 3_000_000,
            sets: { "wake.engine": "openwakeword", ...(phrases.includes("alexa") ? {} : { "wake.phrases": ["alexa"] }) } },
        ],
        ...(weights ? { value: weights } : {}) };
      const head = acoustic && !weights ? [{ key: "wake.openwakeword.modelPath", kind: "string", label: "Head model", help: "The path of a phrase head you trained." }] : [];
      const phrasesField = { key: "wake.phrases", kind: "list", label: "Phrases", help: "Comma separated.", ...(phrases.length ? { value: phrases } : {}) };
      const base = validation("local");
      return { ...base, form: { sections: [...base.form.sections, { id: "wake", label: "Wake word", fields: [model, ...head, phrasesField] }] } };
    }
    if (action === "settings.channel.configure") return { name: "voice", saved: true, saved_keys: [PATCH_KEY] };
    if (action === "settings.channel.connect.start") {
      return { session_id: "", status: "planned", index: { cached_unix: 1, refreshing: false, error: null },
        plan: { fetch: [], prune: [], unknown: [], fetch_bytes: 0, prune_bytes: 0, free_bytes: 1e9 } };
    }
    return settingsPayload();
  });
  const lastPatch = () => JSON.parse((configureCalls().at(-1)![1] as { values: Record<string, string> }).values[PATCH_KEY]) as unknown;

  renderSettingsView({ initialSection: "channels" });
  fireEvent.click(await screen.findByRole("button", { name: "View Voice settings" }));
  // the transcript tier: no key, no head input, Transcript checked rather than Custom
  expect(await screen.findByLabelText("Transcript")).toBeChecked();
  expect(screen.getByLabelText("Custom")).not.toBeChecked();
  expect(screen.queryByLabelText("Head model")).toBeNull();

  // a head: the key, the engine it implies and the phrase it hears, in one edit
  fireEvent.click(screen.getByLabelText(/^alexa/));
  await waitFor(() => expect(configureCalls()).toHaveLength(1));
  expect(lastPatch()).toEqual({ wake: { openwakeword: { weights: "wake/openwakeword/alexa/onnx" }, engine: "openwakeword", phrases: ["alexa"] } });
  expect(await screen.findByLabelText("Phrases")).toHaveValue("alexa");
  expect(screen.getByLabelText(/^alexa/)).toBeChecked();

  // Custom is a head of your own: the engine without a key, its path input, no key input
  fireEvent.click(screen.getByLabelText("Custom"));
  expect(screen.getByLabelText("Custom")).toBeChecked();
  expect(await screen.findByLabelText("Head model")).toBeInTheDocument();
  expect(screen.queryByLabelText("Model: Custom")).toBeNull();
  expect(screen.getByLabelText("Custom")).toBeChecked();
  expect(screen.getByLabelText("Transcript")).not.toBeChecked();
  fireEvent.change(screen.getByLabelText("Head model"), { target: { value: "/models/hey_nanobot.onnx" } });
  await waitFor(() => expect(lastPatch()).toEqual({ wake: { openwakeword: { weights: null, modelPath: "/models/hey_nanobot.onnx" }, engine: "openwakeword", phrases: ["alexa"] } }));

  // back to Transcript: the key stays withdrawn, the engine goes with it, the phrases stay
  fireEvent.click(screen.getByLabelText("Transcript"));
  await waitFor(() => expect(lastPatch()).toEqual({ wake: { openwakeword: { weights: null, modelPath: "/models/hey_nanobot.onnx" }, engine: "text", phrases: ["alexa"] } }));
  await waitFor(() => expect(screen.queryByLabelText("Head model")).toBeNull());
  expect(screen.getByLabelText("Transcript")).toBeChecked();
  expect(screen.getByLabelText("Custom")).not.toBeChecked();
});

it("shows the connector's refusal and keeps a custom key editable", async () => {
  stubFeatures(() => voiceFeature());
  requestMutationMock.mockImplementation(async (action: string, payload: Record<string, unknown>) => {
    if (action === "settings.channel.validate") {
      const base = validation("local");
      return { ...base, form: { sections: [...base.form.sections, {
        id: "stt", label: "Speech-to-text",
        fields: [{ key: "stt.whisper.weights", kind: "weights", label: "Model", choices: [
          { value: "stt/whisper/base/onnx", label: "base", installed: false, bytes: 1 },
        ], value: "stt/whisper/mine/onnx" }],
      }] } };
    }
    if (action === "settings.channel.connect.start") {
      if (payload.plan) {
        return { session_id: "", status: "planned", index: { cached_unix: 0, refreshing: false, error: "cannot read weights index: offline" },
          plan: { fetch: [], prune: [], unknown: ["stt/whisper/mine/onnx"], fetch_bytes: 0, prune_bytes: 0, free_bytes: 0 } };
      }
      throw new Error("not in the model index: stt/whisper/mine/onnx");
    }
    return settingsPayload();
  });

  renderSettingsView({ initialSection: "channels" });
  fireEvent.click(await screen.findByRole("button", { name: "View Voice settings" }));
  // a value outside the index selects Custom with the key in its input
  const custom = await screen.findByLabelText("Model: Custom");
  expect(custom).toHaveValue("stt/whisper/mine/onnx");
  expect(screen.getByLabelText("Custom")).toBeChecked();
  expect(await screen.findByText("stt/whisper/mine/onnx is not in the model index. Fetch it by hand or pick a listed model.")).toBeInTheDocument();
  expect(screen.getByText("The model index could not be refreshed. The choices are the last cached list.", { exact: false })).toBeInTheDocument();
  expect(screen.getByText("cannot read weights index: offline")).toBeInTheDocument(); // what failed, and where
  // the offline notice retries in place, reloading the index
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(connectCalls("start")).toHaveLength(2));
  expect(connectCalls("start")[1][1]).toEqual({ channel: "voice", plan: true, refresh: true });
  // the toggle enables through Apply, so it waits on the same thing: the row above names
  // the key and the remedy, where the connector's own refusal would name neither
  const toggle = screen.getByRole("switch", { name: "Enable channel" });
  expect(toggle).toBeDisabled();
  fireEvent.click(toggle);
  expect(connectCalls("start").filter((call) => !(call[1] as { plan?: boolean }).plan)).toHaveLength(0);
  expect(toggle).not.toBeChecked();
});

it("offers a model the index changed since as an update, and says when one could not land", async () => {
  stubFeatures(() => voiceFeature({ enabled: true, runtime_status: "running" }));
  const progress = { stage: "fetch", key: "stt/whisper/base/onnx", file: "encoder.onnx", done_bytes: 0, total_bytes: 62_000_000, keys_done: 0, keys_total: 2 };
  requestMutationMock.mockImplementation(async (action: string, payload: Record<string, unknown>) => {
    if (action === "settings.channel.validate") return validation("local");
    if (action === "settings.channel.connect.start" && payload.plan) {
      return { session_id: "", status: "planned", index: { cached_unix: 1, refreshing: false, error: null },
        plan: { fetch: [
          { key: "stt/whisper/base/onnx", bytes: 60_000_000, update: true, license: "MIT", notice: null },
          { key: "vad/silero/v6/onnx", bytes: 2_000_000, update: false, license: "MIT", notice: null },
        ], prune: [], unknown: [], fetch_bytes: 62_000_000, prune_bytes: 0, free_bytes: 1e9 } };
    }
    if (action === "settings.channel.connect.start") return { session_id: "s1", status: "pending", interval_ms: 40, progress };
    if (action === "settings.channel.connect.poll") {
      return { session_id: "s1", status: "succeeded", interval_ms: 40, message: "Models fetched 1 (2 MB).",
        warning: "stt/whisper/base/onnx stays as installed: download failed", progress: { ...progress, stage: "done" } };
    }
    return settingsPayload();
  });

  renderSettingsView({ initialSection: "channels" });
  fireEvent.click(await screen.findByRole("button", { name: "View Voice settings" }));
  // an update needs no pending edit to apply
  const apply = await screen.findByRole("button", { name: "Fetch 62 MB and restart" });
  expect(apply).toBeEnabled();
  expect(screen.getByText("update · 60 MB")).toBeInTheDocument();
  expect(screen.getByText("2 MB")).toBeInTheDocument();
  // the run succeeds on the installed model, and the notice says which stayed
  fireEvent.click(apply);
  expect(await screen.findByText("stt/whisper/base/onnx stays as installed: download failed")).toBeInTheDocument();
});

it("picks an engine's first model with the engine", async () => {
  stubFeatures(() => voiceFeature());
  requestMutationMock.mockImplementation(async (action: string) => {
    if (action === "settings.channel.validate") {
      const base = validation("local");
      const turn = { key: "vad.turn.engine", kind: "enum", label: "End of turn", value: "none",
        choices: [{ value: "none", label: "None" }, { value: "smartturn", label: "Smart Turn", sets: { "vad.turn.weights": "vad/smartturn/v3.2/onnx" } }] };
      return { ...base, form: { sections: [...base.form.sections, { id: "vad", label: "Listening", fields: [turn] }] } };
    }
    if (action === "settings.channel.configure") return { name: "voice", saved: true, saved_keys: [PATCH_KEY] };
    if (action === "settings.channel.connect.start") {
      return { session_id: "", status: "planned", index: { cached_unix: 1, refreshing: false, error: null },
        plan: { fetch: [], prune: [], unknown: [], fetch_bytes: 0, prune_bytes: 0, free_bytes: 1e9 } };
    }
    return settingsPayload();
  });

  renderSettingsView({ initialSection: "channels" });
  fireEvent.click(await screen.findByRole("button", { name: "View Voice settings" }));
  fireEvent.click(await screen.findByLabelText("Smart Turn"));
  await waitFor(() => expect(configureCalls()).toHaveLength(1));
  expect(JSON.parse((configureCalls()[0][1] as { values: Record<string, string> }).values[PATCH_KEY]))
    .toEqual({ vad: { turn: { engine: "smartturn", weights: "vad/smartturn/v3.2/onnx" } } });
});
