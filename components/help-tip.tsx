import { InfoTooltip } from "@/components/info-tooltip";
import { HELP, type HelpId } from "@/lib/help/content";

/** A ? that explains one thing on screen. The words come from
 * lib/help/content.ts - never write help copy inline at the call site. */
export function HelpTip({ id }: { id: HelpId }) {
  const { title, tip, learnMore } = HELP[id];
  return (
    <InfoTooltip label={`What "${title}" means`} learnMore={learnMore}>
      {tip}
    </InfoTooltip>
  );
}
