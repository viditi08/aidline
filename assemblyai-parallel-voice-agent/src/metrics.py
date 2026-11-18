"""Per-turn latency reporting for the voice pipeline.

Adapted from https://github.com/tom-aai/assemblyai-livekit-tts. Logs each STT, LLM
and TTS metric as it arrives and, when the agent's reply is committed, a summary box
with end-of-utterance delay, transcription delay, LLM TTFT, TTS TTFB and end-to-end
turn latency. Tool calls (web searches) show up as extra LLM turns, which makes the
cost of each search easy to see.

See https://docs.livekit.io/testing/observability/data/
"""

from __future__ import annotations

import logging

from livekit.agents import AgentSession, ConversationItemAddedEvent
from livekit.agents.llm import ChatMessage, MetricsReport
from livekit.agents.metrics import LLMMetrics, STTMetrics, TTSMetrics

metrics_logger = logging.getLogger("agent.metrics")
metrics_logger.setLevel(logging.INFO)


_BOX_WIDTH = 48  # total characters per rendered line
_VALUE_WIDTH = 12  # right-aligned column for formatted values


def _fmt_latency(seconds: float | None) -> str:
    """Render a latency value in milliseconds, or an em dash when it's missing."""
    if seconds is None:
        return "—"
    return f"{seconds * 1000:,.1f} ms"


def _fmt_duration(seconds: float | None) -> str:
    """Render a duration value in seconds, or an em dash when it's missing."""
    if seconds is None:
        return "—"
    return f"{seconds:,.2f} s"


def _box_rule(left: str, right: str) -> str:
    return left + "─" * (_BOX_WIDTH - 2) + right


def _box_title(text: str) -> str:
    return f"│ {text:^{_BOX_WIDTH - 4}} │"


def _box_row(label: str, value: str) -> str:
    label_w = _BOX_WIDTH - 4 - _VALUE_WIDTH
    return f"│ {label:<{label_w}}{value:>{_VALUE_WIDTH}} │"


class TurnMetricsReporter:
    """Collects LiveKit pipeline metrics and logs per-component and per-turn latency."""

    def __init__(self) -> None:
        # The end-of-utterance and transcription delays land on the user's message,
        # while the LLM/TTS/end-to-end metrics land on the following assistant message.
        # Hold the most recent user-turn metrics so both halves report together.
        self._pending_user_metrics: MetricsReport = {}

    def attach(self, session: AgentSession) -> None:
        """Subscribe to the session's per-component and conversation events."""
        if session.stt is not None:
            session.stt.on("metrics_collected", self._on_stt_metrics)
        if session.llm is not None:
            session.llm.on("metrics_collected", self._on_llm_metrics)
        if session.tts is not None:
            session.tts.on("metrics_collected", self._on_tts_metrics)
        session.on("conversation_item_added", self._on_conversation_item_added)

    # -- Per-component metrics, logged as each pipeline stage finishes ---------

    def _on_stt_metrics(self, m: STTMetrics) -> None:
        metrics_logger.info(
            "STT  · processing %s · audio %s",
            _fmt_latency(m.duration),
            _fmt_duration(m.audio_duration),
        )

    def _on_llm_metrics(self, m: LLMMetrics) -> None:
        if m.cancelled:
            metrics_logger.info("LLM  · cancelled (interrupted)")
            return
        metrics_logger.info(
            "LLM  · TTFT %s · %d tokens · %.1f tok/s",
            _fmt_latency(m.ttft),
            m.completion_tokens,
            m.tokens_per_second,
        )

    def _on_tts_metrics(self, m: TTSMetrics) -> None:
        if m.cancelled:
            metrics_logger.info("TTS  · cancelled (interrupted)")
            return
        metrics_logger.info(
            "TTS  · TTFB %s · audio %s · %d chars",
            _fmt_latency(m.ttfb),
            _fmt_duration(m.audio_duration),
            m.characters_count,
        )

    # -- Per-turn summary, logged when the agent's reply is committed ----------

    def _on_conversation_item_added(self, ev: ConversationItemAddedEvent) -> None:
        item = ev.item
        if not isinstance(item, ChatMessage):
            return
        metrics = item.metrics or {}
        if item.text_content:
            who = "USER " if item.role == "user" else "AGENT"
            metrics_logger.info("%s · %s", who, item.text_content)
        if item.role == "user":
            self._pending_user_metrics = metrics
        elif item.role == "assistant":
            self._log_turn_summary(self._pending_user_metrics, metrics)
            self._pending_user_metrics = {}

    def _log_turn_summary(
        self, user_metrics: MetricsReport, assistant_metrics: MetricsReport
    ) -> None:
        rows = [
            ("End of utterance delay", user_metrics.get("end_of_turn_delay")),
            ("Transcription delay", user_metrics.get("transcription_delay")),
            ("LLM time to first token", assistant_metrics.get("llm_node_ttft")),
            ("TTS time to first byte", assistant_metrics.get("tts_node_ttfb")),
        ]
        rows = [(label, value) for label, value in rows if value is not None]
        e2e_latency = assistant_metrics.get("e2e_latency")
        if not rows and e2e_latency is None:
            return

        lines = [
            "",
            _box_rule("┌", "┐"),
            _box_title("Turn latency summary"),
            _box_rule("├", "┤"),
            *(_box_row(label, _fmt_latency(value)) for label, value in rows),
        ]
        if e2e_latency is not None:
            lines.append(_box_rule("├", "┤"))
            lines.append(_box_row("End-to-end turn latency", _fmt_latency(e2e_latency)))
        lines.append(_box_rule("└", "┘"))
        metrics_logger.info("\n".join(lines))
