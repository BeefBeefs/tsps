import { packHsl } from "../util/ColorUtil";

/** The overlay fields the flat floor colour is taken from. */
export interface OverlayColourSource {
    primaryRgb: number;
    secondaryRgb: number;
    hue: number;
    saturation: number;
    lightness: number;
    secondaryHue: number;
    secondarySaturation: number;
    secondaryLightness: number;
}

/**
 * The cache marks a blended overlay with the `0xFF00FF` sentinel: its visible
 * colour is the secondary field (underlays under paths match it, and the
 * Ancient Vault floor has no underlay at all, so the secondary is the only
 * colour the tile has). Without a secondary the overlay draws nothing.
 */
export function overlayFloorHsl(overlay: OverlayColourSource): number {
    if (overlay.primaryRgb === 0xff00ff) {
        return overlay.secondaryRgb === -1
            ? -2
            : packHsl(overlay.secondaryHue, overlay.secondarySaturation, overlay.secondaryLightness);
    }
    return packHsl(overlay.hue, overlay.saturation, overlay.lightness);
}
