import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Download, Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { channelFieldMessageKey, channelTranslator } from "@/channel-plugins/i18n";
import { channelLocaleMessages } from "@/channel-plugins/locale-registry";
import type { ChannelPluginPanelProps } from "@/channel-plugins/types";
import { ToggleButton } from "@/components/settings/ToggleButton";
import { CredentialForm } from "@/components/settings/channels/CredentialForm";
import {
  CHANNEL_SETUP_PANEL_CLASS_NAME,
  ChannelLogo,
  ChannelRuntimeError,
  ChannelStatusBadge,
  channelStatusLabel,
  channelToggleChecked,
  localizedChannelDisplayName,
} from "@/components/settings/channels/ChannelIdentity";
import { ChannelValidationProgress } from "@/components/settings/channels/ChannelValidationProgress";
import { channelValidationMessage } from "@/components/settings/channels/validationMessages";
import { useAutoSave } from "@/components/settings/shared/useAutoSave";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiError,
  cancelChannelConnect,
  disableNanobotFeature,
  pollChannelConnect,
  startChannelConnect,
  validateChannel,
  configureChannel,
} from "@/lib/api";
import { normalizeLocale } from "@/i18n/config";
import { cn } from "@/lib/utils";
import { useClient } from "@/providers/ClientProvider";

import { ChoiceChips, wideChoices } from "./ChoiceChips";
import { FieldHelp } from "./FieldHelp";
import { NumberRow } from "./NumberRow";
import { SwitchRow } from "./SwitchRow";
import { WeightsPicker } from "./WeightsPicker";
import {
  PATCH_KEY,
  RESET_KEY,
  formatBytes,
  formatValue,
  getPath,
  parsePatch,
  sectionOf,
  parseValue,
  patchValues,
  pick,
  toConfigField,
  withPath,
  withPaths,
  type VoiceForm,
  type VoiceFormField,
  type VoicePatch,
  type VoiceValidationPayload,
  runsOf,
} from "./form";
import {
  ENDED,
  pendingNotices,
  planHasWork,
  type SyncPayload,
  type SyncPlan,
  type SyncProgress,
} from "./sync";

const REFRESH_DELAY_MS = 400;
const POLL_RETRY_MS = 3000;
const INDEX_POLL_MS = 1000;

type SyncRun = { sessionId: string; intervalMs?: number; progress?: SyncProgress };

/**
 * The voice channel's setup: a form the validator shapes for the section as it stands
 * (backend, engines, wake mode), edited as one pending patch that rides the manifest's
 * JSON field and applies when the channel starts. Every edit re-asks the validator, so
 * the fields, the check rows and the identity line stay one picture of the same section.
 * Advanced opens the patch itself (Config import), the sections and rows the validator
 * marks advanced in place (a section the setup does not use carries a note naming the
 * switch that would), and Reset, which makes the patch the `$reset` directive: the
 * defaults first, later edits on top.
 * Apply runs the channel's connector (core's start/poll/cancel routes): the models the
 * section names are fetched with progress, the ones this flow installed and the section
 * dropped are removed, and core (re)starts the channel on success. The run lives in the
 * gateway: the panel follows it by polling, and picks it up again when reopened.
 */
export function VoicePanel({
  feature,
  actionKey,
  showBrandLogos,
  onFeaturesUpdate,
  onBeforeCloseChange,
}: ChannelPluginPanelProps) {
  const { client } = useClient();
  const { t, i18n } = useTranslation();
  const tx = channelTranslator(t, "voice");
  const core = (key: string, fallback: string) => t(key, { defaultValue: fallback });
  const displayName = localizedChannelDisplayName(feature, t);
  const messages = channelLocaleMessages(
    "voice",
    normalizeLocale(i18n.resolvedLanguage ?? i18n.language),
  );
  const echoedPatch = feature.config_values?.[PATCH_KEY];

  const [patch, setPatch] = useState<VoicePatch>(() => parsePatch(echoedPatch));
  const [savedPatch, setSavedPatch] = useState(() => JSON.stringify(parsePatch(echoedPatch)));
  const [form, setForm] = useState<VoiceForm | null>(null);
  const [validation, setValidation] = useState<VoiceValidationPayload | null>(null);
  // True from the first render: the form's request goes out in the open effect, and the
  // rows area waits on it rather than flashing empty for a frame.
  const [refreshing, setRefreshing] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  // What a row is being typed into, until it is left: the patch holds the parsed value, so
  // a list's separator, a decimal point or a cleared field would otherwise be read back as
  // the resolved value between two keystrokes.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rawText, setRawText] = useState(() => JSON.stringify(parsePatch(echoedPatch), null, 2));
  const [rawError, setRawError] = useState(false);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [sync, setSync] = useState<SyncRun | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [formEpoch, setFormEpoch] = useState(0);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const refreshSerial = useRef(0);
  const planSerial = useRef(0);
  const advancedPanelId = useId();

  const patchText = JSON.stringify(patch);
  const dirty = patchText !== savedPatch;
  const busy = saving || pendingEnabled !== null || Boolean(actionKey) || sync !== null;

  // The echo is the pending paste as core persisted it: the source of truth whenever
  // nothing is being edited, and its disappearance means start() applied it.
  useEffect(() => {
    if (dirty) return;
    const echoed = parsePatch(echoedPatch);
    setPatch(echoed);
    setDrafts({});
    setSavedPatch(JSON.stringify(echoed));
    setRawText(JSON.stringify(echoed, null, 2));
    setRawError(false);
  }, [echoedPatch, feature.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // The form is this request's answer: sent at once on open (and ahead of the plan's
  // request, since core answers a socket's requests one at a time), settled after a
  // pause while editing.
  const opened = useRef(false);
  useEffect(() => {
    const serial = ++refreshSerial.current;
    const validate = () => {
      // Only once the request is actually sent: set at every keystroke it would replace
      // the whole Resolved setup with "Checking..." for the length of the debounce.
      setRefreshing(true);
      void validateChannel(client, feature.name, patchValues(patch))
        .then((payload: VoiceValidationPayload) => {
          if (serial !== refreshSerial.current) return;
          setCheckError(null);
          setValidation(payload);
          // A refused section carries no form: keep the last one so its fields stay
          // editable while the failing row says what to fix.
          if (payload.form) setForm(payload.form);
        })
        .catch((err: Error) => {
          // Its own state: a read-only request that failed (a socket blip) must not gate
          // the autosave of the edit that triggered it.
          if (serial === refreshSerial.current) setCheckError(err.message);
        })
        .finally(() => {
          if (serial === refreshSerial.current) setRefreshing(false);
        });
    };
    if (!opened.current) {
      opened.current = true;
      validate();
      return undefined;
    }
    const timer = window.setTimeout(validate, REFRESH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [client, feature.name, patchText, formEpoch]); // eslint-disable-line react-hooks/exhaustive-deps

  // What Apply would move, for the saved section, from the cached index: asked on open
  // and after every save. The open also asks for the index to be reloaded, so opening
  // the panel is how one checks for new models; the reload runs behind the answer and
  // the panel polls the plan while it does, re-asking for the form once it lands (the
  // Model pills are drawn from the cache). A run still going answers instead of a plan,
  // and the panel follows it to the end first; one that ended while this panel was closed
  // answers with its result, which is settled here — the channel starts on it. A core
  // without the connector routes answers 404, and the panel simply has no plan.
  const reloading = useRef(false);
  const cachedAt = useRef<number | undefined>(undefined);
  const settled = useRef(new Set<string>());
  const [indexPoll, setIndexPoll] = useState(0);
  const refreshPlan = useCallback(async (reloadIndex = false) => {
    const serial = ++planSerial.current;
    if (reloadIndex) reloading.current = true;
    try {
      const payload = (await startChannelConnect(client, feature.name, {
        plan: true,
        ...(reloadIndex ? { refresh: true } : {}),
      })) as SyncPayload;
      if (serial !== planSerial.current) return;
      if (payload.status === "pending" && payload.session_id) {
        setSync({ sessionId: payload.session_id, intervalMs: payload.interval_ms, progress: payload.progress });
        return;
      }
      // A run that ended while this panel was closed: its last word, once — the panel
      // settles it (core has started the channel on it) and asks for the plan again.
      if (ENDED.has(payload.status ?? "") && !settled.current.has(payload.session_id ?? "")) {
        settled.current.add(payload.session_id ?? "");
        settleRef.current(payload);
        return;
      }
      setPlan(payload.plan ?? null);
      setIndexError(payload.index?.error ?? null);
      const cached = payload.index?.cached_unix;
      if (payload.index?.refreshing) {
        setIndexPoll((count) => count + 1);
      } else if (reloading.current) {
        reloading.current = false;
        // The Model pills are drawn from the cache, so only a reload that moved it is
        // worth a second validate; an unknown age (the reload beat the first answer) is.
        const moved = cachedAt.current === undefined || cached !== cachedAt.current;
        if (!payload.index?.error && moved) setFormEpoch((epoch) => epoch + 1);
      }
      cachedAt.current = cached;
    } catch {
      if (serial === planSerial.current) setPlan(null);
    }
  }, [client, feature.name]);
  useEffect(() => {
    void refreshPlan(true);
  }, [refreshPlan]);
  useEffect(() => {
    if (!indexPoll) return undefined;
    const timer = window.setTimeout(() => void refreshPlan(), INDEX_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [indexPoll, refreshPlan]);

  // A run's last word: core (re)started the channel on "succeeded", so its features land
  // and the fields' installed marks are re-read; anything else is said in the notice. Held
  // in a ref as well, since the plan request can be the one that receives it.
  const settleRef = useRef<(payload: SyncPayload) => void>(() => {});
  const settleSync = useCallback((payload: SyncPayload) => {
    if (payload.status === "succeeded") {
      if (payload.nanobot_features) onFeaturesUpdate(payload.nanobot_features);
      setFormEpoch((epoch) => epoch + 1);
    } else {
      setNotice(payload.message ?? core("settings.channels.validationFailed", "Check the required setup before enabling."));
    }
    void refreshPlan();
  }, [onFeaturesUpdate, refreshPlan]); // eslint-disable-line react-hooks/exhaustive-deps
  settleRef.current = settleSync;

  // Follow the run by polling, the way core's connect flows do: a poll that fails is
  // retried, since the download goes on in the gateway, unless the session is gone (a
  // gateway restart); the poll that answers "succeeded" is the one core starts the
  // channel on.
  useEffect(() => {
    if (!sync) return;
    const { sessionId } = sync;
    let cancelled = false;
    let failed = false;
    let timer = 0;
    const poll = async () => {
      let payload: SyncPayload;
      try {
        payload = (await pollChannelConnect(client, feature.name, sessionId)) as SyncPayload;
      } catch (err) {
        if (cancelled) return;
        failed = true;
        setNotice((err as Error).message);
        if (err instanceof ApiError && err.status === 404) {
          setSync(null);
          void refreshPlan();  // the session is gone (a gateway restart): plan afresh
        } else timer = window.setTimeout(() => void poll(), POLL_RETRY_MS);
        return;
      }
      if (cancelled) return;
      if (failed) {
        failed = false;
        setNotice(null);
      }
      if (payload.status === "pending") {
        setSync({ sessionId, intervalMs: payload.interval_ms, progress: payload.progress });
        timer = window.setTimeout(() => void poll(), payload.interval_ms ?? 1000);
        return;
      }
      setSync(null);
      settleSync(payload);
    };
    timer = window.setTimeout(() => void poll(), sync.intervalMs ?? 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [client, feature.name, sync?.sessionId, settleSync, refreshPlan]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyPatch = (next: VoicePatch) => {
    setPatch(next);
    setRawText(JSON.stringify(next, null, 2));
    setRawError(false);
    setNotice(null);
    setSaved(false);
    setDrafts({});  // a pick (or a `sets` with it) is the new text of every row it writes
  };

  /** A row being typed into: the patch takes the parsed value, the input keeps the text. */
  const typeInto = (field: VoiceFormField, text: string) => {
    applyPatch(withPath(patch, field.key, parseValue(field, text)));
    setDrafts({ [field.key]: text });
  };
  const leave = (field: VoiceFormField) => {
    setDrafts((current) => {
      const rest = { ...current };
      delete rest[field.key];
      return rest;
    });
  };

  const saveSettings = useCallback(async (): Promise<boolean> => {
    if (savePromiseRef.current) return savePromiseRef.current;
    if (!dirty) return true;
    if (busy) return false;
    const save = (async () => {
      setSaving(true);
      setSaved(false);
      setNotice(null);
      try {
        // An emptied patch is still written: `{}` clears a pending paste.
        const payload = await configureChannel(client, feature.name, { [PATCH_KEY]: patchText });
        setSavedPatch(patchText);
        if (payload.nanobot_features) onFeaturesUpdate(payload.nanobot_features);
        setSaved(true);
        void refreshPlan();
        return true;
      } catch (err) {
        setNotice((err as Error).message);
        return false;
      } finally {
        setSaving(false);
      }
    })();
    savePromiseRef.current = save;
    const result = await save;
    if (savePromiseRef.current === save) savePromiseRef.current = null;
    return result;
  }, [busy, client, dirty, feature.name, onFeaturesUpdate, patchText, refreshPlan]);

  useAutoSave({ patchText }, dirty, busy, () => void saveSettings(), !notice && !rawError);

  useEffect(() => {
    if (!saved) return;
    const timeout = window.setTimeout(() => setSaved(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [saved]);

  useEffect(() => {
    onBeforeCloseChange?.(dirty ? saveSettings : null);
    return () => onBeforeCloseChange?.(null);
  }, [dirty, saveSettings, onBeforeCloseChange]);

  // Sync the store to the saved section, then let core start the channel: the connector
  // answers "succeeded" at once when nothing needs moving, else "pending" and the poller
  // follows the run.
  const runSync = async () => {
    const payload = (await startChannelConnect(client, feature.name, {
      accept: [...accepted].join(","),
    })) as SyncPayload;
    if (payload.status === "pending" && payload.session_id) {
      setSync({ sessionId: payload.session_id, intervalMs: payload.interval_ms, progress: payload.progress });
      return;
    }
    settleSync(payload);
  };

  const enabled = pendingEnabled ?? channelToggleChecked(feature);
  const running = feature.runtime_status === "running" || feature.runtime_status === "starting";
  const apply = async () => {
    if (busy) return;
    setPendingEnabled(true);
    setNotice(null);
    try {
      if (!(await saveSettings())) return;
      const checked: VoiceValidationPayload = await validateChannel(client, feature.name);
      setValidation(checked);
      if (checked.form) setForm(checked.form);
      if (!checked.can_enable) {
        setNotice(
          checked.message
            ? channelValidationMessage(checked.message, t)
            : core("settings.channels.validationFailed", "Check the required setup before enabling."),
        );
        return;
      }
      await runSync();
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setPendingEnabled(null);
    }
  };
  const toggleEnabled = async (next: boolean) => {
    if (next) {
      await apply();
      return;
    }
    if (busy) return;
    setPendingEnabled(false);
    setNotice(null);
    try {
      onFeaturesUpdate(await disableNanobotFeature(client, feature.name));
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setPendingEnabled(null);
    }
  };
  // The connector answers once the download thread has stopped, which can take a chunk.
  const cancelSync = async () => {
    if (!sync || cancelling) return;
    setCancelling(true);
    try {
      const payload = (await cancelChannelConnect(client, feature.name, sync.sessionId)) as SyncPayload;
      if (payload.status !== "pending") {
        setSync(null);
        settleSync(payload);
      }
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  // A model's license as one line: the index's license id, then the notice to accept.
  const licenseText = (item: { license?: string | null; notice?: string | null }) => [
    item.license ? tx("custom.license", "License: {{license}}.", { license: item.license }) : "",
    item.notice ?? "",
  ].filter(Boolean).join(" ");

  const unaccepted = pendingNotices(plan, accepted);
  const pendingCount = Object.keys(patch).length;
  const showApply = planHasWork(plan) || (pendingCount > 0 && running);
  const applyBlocked = unaccepted.length > 0 || Boolean(plan?.unknown.length);
  const applyLabel = plan?.fetch_bytes
    ? running
      ? tx("custom.applyFetchRestart", "Fetch {{size}} and restart", { size: formatBytes(plan.fetch_bytes) })
      : tx("custom.applyFetch", "Fetch {{size}} and start", { size: formatBytes(plan.fetch_bytes) })
    : running
      ? tx("custom.applyRestart", "Apply and restart")
      : tx("custom.applyStart", "Apply and start");

  const fieldValues = useMemo(() => {
    const values: Record<string, string> = {};
    for (const section of form?.sections ?? []) {
      for (const field of section.fields) {
        const pending = getPath(patch, field.key);
        values[field.key] = formatValue(field, pending !== undefined ? pending : field.value);
      }
    }
    return values;
  }, [form, patch]);
  const configuredFields = useMemo(() => {
    const keys = new Set<string>();
    for (const section of form?.sections ?? []) {
      for (const field of section.fields) {
        if (field.kind === "secret" && field.configured) keys.add(field.key);
      }
    }
    return keys;
  }, [form]);

  // Locale files override the validator's English the way they do core's catalog:
  // `setup.fields.<key>` with a label, placeholder and choice labels by value. Every row
  // shows its resolved value, so a placeholder is the locale's alone.
  const localized = (field: VoiceFormField) => {
    const copy = messages?.setup.fields?.[channelFieldMessageKey("voice", field.key)];
    const choices = field.choices?.map((choice) => ({
      ...choice,
      label: copy?.choices?.[choice.value] ?? choice.label,
    }));
    return {
      choices,
      config: toConfigField(field, copy?.label ?? field.label, copy?.placeholder, choices),
    };
  };

  const onRawChange = (text: string) => {
    setRawText(text);
    try {
      const parsed: unknown = JSON.parse(text.trim() || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object");
      setRawError(false);
      setPatch(sectionOf(parsed as VoicePatch));
      setNotice(null);
      setSaved(false);
    } catch {
      setRawError(true);
    }
  };

  const row = (field: VoiceFormField) => {
    const { choices, config } = localized(field);
    return field.kind === "weights" ? (
      <WeightsPicker
        key={field.key}
        label={config.label}
        help={field.help}
        choices={choices ?? []}
        value={fieldValues[field.key] ?? ""}
        disabled={busy}
        customLabel={tx("custom.customModel", "Custom")}
        custom={field.custom}
        customOpen={field.customOpen}
        sets={field.sets}
        buildLabel={tx("custom.build", "Build")}
        installedLabel={tx("custom.installed", "installed")}
        licenseText={licenseText}
        onChange={(next, sets) => applyPatch(withPaths(withPath(patch, field.key, next), sets))}
      />
    ) : field.kind === "int" || field.kind === "float" ? (
      <NumberRow
        key={field.key}
        label={config.label}
        help={field.help}
        unit={field.unit}
        decimal={field.kind === "float"}
        signed={field.signed}
        value={drafts[field.key] ?? fieldValues[field.key] ?? ""}
        placeholder={config.placeholder}
        disabled={busy}
        onChange={(text) => typeInto(field, text)}
        onBlur={() => leave(field)}
      />
    ) : field.kind === "bool" ? (
      <SwitchRow
        key={field.key}
        label={config.label}
        help={field.help}
        checked={fieldValues[field.key] === "true"}
        disabled={busy}
        stateLabel={fieldValues[field.key] === "true" ? core("settings.values.on", "On") : core("settings.values.off", "Off")}
        onChange={(next) => applyPatch(withPath(patch, field.key, next))}
      />
    ) : field.kind === "enum" && wideChoices(choices ?? []) ? (
      <ChoiceChips
        key={field.key}
        label={config.label}
        help={field.help}
        choices={choices ?? []}
        value={fieldValues[field.key] ?? ""}
        disabled={busy}
        onChange={(choice) => applyPatch(pick(patch, field, choice))}
      />
    ) : (
      <div key={field.key} onBlur={() => leave(field)}>
        <CredentialForm
          fields={[config]}
          values={{ ...fieldValues, ...drafts }}
          configuredFields={configuredFields}
          visibleSecrets={visibleSecrets}
          onChange={(_key, text) => (field.kind === "enum" ? applyPatch(pick(patch, field, text)) : typeInto(field, text))}
          onToggleSecret={(key) => {
            setVisibleSecrets((current) => ({ ...current, [key]: !current[key] }));
          }}
          compact
        />
        {field.help ? (
          <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-x-4">
            <span aria-hidden />
            <FieldHelp text={field.help} />
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <aside className={CHANNEL_SETUP_PANEL_CLASS_NAME}>
      <form
        className="flex min-w-0 flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void saveSettings();
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pe-20">
          <ChannelLogo feature={feature} showBrandLogos={showBrandLogos} />
          <h3 className="sr-only">{displayName}</h3>
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={cn(
              "ms-auto inline-flex items-center gap-1.5 text-[11px] text-muted-foreground",
              !saving && !saved && "sr-only",
            )}
          >
            {saving ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden />
                {core("settings.actions.saving", "Saving")}
              </>
            ) : saved ? (
              <>
                <Check className="h-3 w-3" aria-hidden />
                {core("settings.channels.savedSettings", "Settings saved.")}
              </>
            ) : null}
          </span>
          <button
            type="button"
            className="inline-flex min-h-8 items-center gap-1.5 rounded px-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-offset-2"
            aria-expanded={advancedOpen}
            aria-controls={advancedPanelId}
            onClick={() => setAdvancedOpen((current) => !current)}
          >
            {core("settings.channels.advanced", "Advanced")}
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform motion-reduce:transition-none",
                advancedOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
        </div>
        <p className="-mt-2 text-[12.5px] leading-5 text-muted-foreground">
          {tx("custom.description", "Talk to nanobot through a microphone and speaker on this machine, or through a realtime speech-to-speech provider.")}
        </p>
        <ChannelRuntimeError message={feature.runtime_error} />

        <div id={advancedPanelId} hidden={!advancedOpen} className="space-y-2">
          <label htmlFor={`${advancedPanelId}-raw`} className="block text-[12px] font-medium text-muted-foreground">
            {tx("custom.configImport", "Config import")}
          </label>
          <Textarea
            id={`${advancedPanelId}-raw`}
            value={rawText}
            rows={8}
            spellCheck={false}
            disabled={busy}
            aria-invalid={rawError}
            onChange={(event) => onRawChange(event.target.value)}
            className={cn(
              "resize-y border-border/40 bg-background font-mono text-[12px]",
              rawError && "border-destructive focus-visible:ring-destructive/30",
            )}
          />
          <p className="text-[11px] leading-4 text-muted-foreground">
            {rawError
              ? tx("custom.invalidJson", "Not a JSON object.")
              : tx("custom.advancedHint", "The pending edits as the channels.voice keys they set. Paste a whole section or a patch here to import it, every key in the schema is accepted.")}
          </p>
          <div className="flex flex-wrap gap-2">
            {/* Reset is itself a pending patch: the directive alone, later edits on top. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || (pendingCount === 1 && patch[RESET_KEY] === true)}
              className="h-auto min-h-8 rounded-full text-[12px] text-muted-foreground"
              onClick={() => applyPatch({ [RESET_KEY]: true })}
            >
              {tx("custom.reset", "Reset to defaults")}
            </Button>
            {pendingCount ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                className="h-auto min-h-8 rounded-full text-[12px] text-muted-foreground"
                onClick={() => applyPatch({})}
              >
                {tx("custom.discard", "Discard pending changes")}
              </Button>
            ) : null}
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {tx("custom.advancedRows", "The less common rows and sections open in place below, shaded.")}
          </p>
        </div>

        {form ? form.sections.filter((section) => advancedOpen || !section.advanced).map((section) => ({
          ...section,
          fields: section.fields.filter((field) => advancedOpen || !field.advanced),
        })).filter((section) => section.fields.length).map((section) => (
          <fieldset key={section.id} className="min-w-0" disabled={busy}>
            <legend className="mb-2 text-[12px] font-medium text-muted-foreground">
              {messages?.setup.sections?.[section.id] ?? section.label}
            </legend>
            {section.note ? (
              <div className="-mt-1 mb-3">
                <FieldHelp text={section.note} />
              </div>
            ) : null}
            <div className="grid gap-y-4">
              {/* The rows Advanced added are shaded where they sit, a run of them as one block,
                  so opening it reads as "these appeared" rather than a form that looks the same.
                  A foreground tint, since `muted` is the dialog's own surface in dark mode. */}
              {runsOf(section.fields).map((run, index) => run.advanced ? (
                <div key={index} className="-mx-3 grid gap-y-4 rounded-xl bg-foreground/[0.06] px-3 py-3">
                  {run.fields.map(row)}
                </div>
              ) : (
                <Fragment key={index}>{run.fields.map(row)}</Fragment>
              ))}
            </div>
          </fieldset>
        )) : refreshing ? (
          <div role="status" className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            {core("settings.status.loading", "Loading")}
          </div>
        ) : null /* answered without a form: the check rows and the notice say why */}

        {sync || planHasWork(plan) || plan?.unknown.length || indexError ? (
          <section className="space-y-2">
            <h4 className="text-[12px] font-medium text-muted-foreground">
              {tx("custom.models", "Models")}
            </h4>
            {sync ? (
              <div className="space-y-1.5" role="status" aria-live="polite">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
                    style={{ width: `${sync.progress?.total_bytes ? Math.min(100, (100 * sync.progress.done_bytes) / sync.progress.total_bytes) : 0}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] leading-4 text-muted-foreground">
                  <span className="min-w-0 break-all">
                    {tx("custom.fetching", "Fetching {{key}}", { key: sync.progress?.key ?? "" })}
                    {sync.progress?.file ? ` · ${sync.progress.file}` : ""}
                    {sync.progress?.total_bytes
                      ? ` · ${formatBytes(sync.progress.done_bytes)} / ${formatBytes(sync.progress.total_bytes)}`
                      : ""}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={cancelling}
                    className="h-auto min-h-7 rounded-full px-2.5 text-[11px] text-muted-foreground"
                    onClick={() => void cancelSync()}
                  >
                    {core("settings.actions.cancel", "Cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <ul className="space-y-1.5 text-[12px] leading-5">
                {plan?.fetch.map((item) => (
                  <li key={item.key} className="min-w-0">
                    <div className="flex items-start gap-2">
                      <Download className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 break-all font-mono text-[11.5px]">{item.key}</span>
                      <span className="ms-auto shrink-0 text-[11px] text-muted-foreground">{item.bytes ? formatBytes(item.bytes) : ""}</span>
                    </div>
                    {item.notice ? (
                      <label className="ms-[22px] mt-1 flex items-start gap-2 text-[11px] leading-4 text-muted-foreground">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={accepted.has(item.key)}
                          disabled={busy}
                          onChange={(event) => {
                            const next = new Set(accepted);
                            if (event.target.checked) next.add(item.key);
                            else next.delete(item.key);
                            setAccepted(next);
                          }}
                        />
                        <span>{licenseText(item)}</span>
                      </label>
                    ) : null}
                  </li>
                ))}
                {plan?.prune.map((item) => (
                  <li key={item.key} className="flex items-start gap-2">
                    <Trash2 className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 break-all font-mono text-[11.5px]">{item.key}</span>
                    <span className="ms-auto shrink-0 text-[11px] text-muted-foreground">{item.bytes ? formatBytes(item.bytes) : ""}</span>
                  </li>
                ))}
                {plan?.unknown.map((key) => (
                  <li key={key} className="text-[11px] leading-4 text-destructive">
                    {tx("custom.unknownModel", "{{key}} is not in the model index. Fetch it by hand or pick a listed model.", { key })}
                  </li>
                ))}
                {plan && (plan.fetch.length || plan.prune.length) ? (
                  <li className="text-[11px] leading-4 text-muted-foreground">
                    {plan.free_bytes
                      ? tx("custom.planSummary", "Apply downloads and removes the models above. {{free}} free.", { free: formatBytes(plan.free_bytes) })
                      : tx("custom.planSummaryNoFree", "Apply downloads and removes the models above.")}
                    {/* A disabled Apply says why: the tick is the one thing it waits for. */}
                    {unaccepted.length ? ` ${tx("custom.acceptFirst", "Accept the notices above to apply.")}` : ""}
                  </li>
                ) : null}
                {indexError ? (
                  <li className="text-[11px] leading-4 text-muted-foreground">
                    {tx("custom.indexOffline", "The model index could not be refreshed. The choices are the last cached list.")}{" "}
                    <button
                      type="button"
                      className="font-medium text-foreground/80 underline-offset-2 hover:underline disabled:opacity-60"
                      disabled={busy}
                      onClick={() => void refreshPlan(true)}
                    >
                      {tx("custom.retry", "Retry")}
                    </button>
                  </li>
                ) : null}
              </ul>
            )}
          </section>
        ) : null}

        <section className="space-y-2">
          <h4 className="text-[12px] font-medium text-muted-foreground">
            {tx("custom.resolved", "Resolved setup")}
          </h4>
          <ChannelValidationProgress validation={validation} validating={refreshing} feature={feature} />
          {Object.keys(patch).length ? (
            <p className="text-[11px] leading-4 text-muted-foreground">
              {tx("custom.appliesOnStart", "Pending changes apply when the channel starts.")}
            </p>
          ) : null}
        </section>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {showApply ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || applyBlocked}
              className="h-8 rounded-full px-3 text-[12px] font-semibold"
              onClick={() => void apply()}
            >
              {applyLabel}
            </Button>
          ) : null}
          <ChannelStatusBadge status={feature.runtime_status}>
            {channelStatusLabel(feature, core)}
          </ChannelStatusBadge>
          <ToggleButton
            checked={enabled}
            disabled={busy || (!enabled && applyBlocked)}
            label={core("settings.channels.enable", "Enable channel")}
            onChange={(next) => void toggleEnabled(next)}
          />
        </div>

        <div
          role="status"
          aria-live="polite"
          className={cn(
            "rounded-control bg-muted/55 px-3 py-2.5 text-[12px] leading-5 text-muted-foreground",
            !notice && !checkError && "sr-only",
          )}
        >
          {notice ?? checkError ?? ""}
        </div>
      </form>
    </aside>
  );
}
