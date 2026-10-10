import { usePlugin } from "@opencode/plugin/tui";
import { RGBA, rgbToHex } from "@opentui/core";
import { type ImageProps } from "@opentui/solid";
import { Resvg } from "@resvg/resvg-js";
import { createMemo } from "solid-js";

export function SvgIcon(
  props: ImageProps & { source: string; color: RGBA | string },
) {
  const { source: _, color: __, ...prop } = props;
  const context = usePlugin();

  const pngBuffer = createMemo(() => {
    const bgToken = context.theme.background.base;
    const bg = rgbToHex(bgToken);
    const strokeColor =
      typeof props.color === "string" ? props.color : rgbToHex(props.color);

    const svg = props.source
      .replace(/stroke="[^"]*"/g, `stroke="${strokeColor}"`)
      .replace(/color="[^"]*"/g, `color="${strokeColor}"`);

    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: 64 },
      background: bg,
    });
    return resvg.render().asPng();
  });

  return (
    <image
      source={pngBuffer()}
      width={props.width ?? 2}
      height={props.height ?? 1}
      {...prop}
    />
  );
}
