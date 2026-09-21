import { lazy } from "react";

import type { ChannelUiContribution } from "@/channel-plugins/types";

import { VoiceIcon } from "./VoiceIcon";

const VoicePanel = lazy(() =>
  import("./VoicePanel").then(({ VoicePanel: component }) => ({
    default: component,
  })),
);

// The runtime is an installed package (nanobot-channel-voice) that ships its manifest into
// nanobot.channels.voice; this contribution is the panel core compiles for it. Its fields
// are not declared here: the validator returns them, shaped by the section's own state.
export default {
  Panel: VoicePanel,
  presentation: {
    displayName: "Voice",
    initials: "VO",
    color: "#5B5BD6",
    icon: VoiceIcon,
    setup: {
      mode: "credentials",
    },
  },
} satisfies ChannelUiContribution;
