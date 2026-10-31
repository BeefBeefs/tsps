import { strict as assert } from "node:assert";

import { overlayFloorHsl } from "../rs/scene/OverlayFloorColour";
import { packHsl } from "../rs/util/ColorUtil";

type Overlay = Parameters<typeof overlayFloorHsl>[0];

function overlay(overrides: Partial<Overlay> = {}): Overlay {
    return {
        primaryRgb: 0x3a352c,
        secondaryRgb: -1,
        hue: 8,
        saturation: 42,
        lightness: 30,
        secondaryHue: 12,
        secondarySaturation: 80,
        secondaryLightness: 92,
        ...overrides,
    };
}

// A plain overlay draws in its primary colour.
assert.equal(overlayFloorHsl(overlay()), packHsl(8, 42, 30),
    "an overlay with a real primary colour keeps it");

// The Ancient Vault floor (overlay 154) has the 0xFF00FF blend sentinel as its
// primary; its tan is the secondary field, and the map has no underlay to show
// instead. Reading it as invisible is what left the room floor as sky.
const blend = overlay({
    primaryRgb: 0xff00ff,
    secondaryRgb: 0xcb_ba76,
    secondaryHue: 12,
    secondarySaturation: 80,
    secondaryLightness: 92,
});
assert.equal(overlayFloorHsl(blend), packHsl(12, 80, 92),
    "a blended overlay draws in its secondary colour");
assert.notEqual(overlayFloorHsl(blend), -2, "a blended overlay is not invisible");

// Surrounding void tiles (overlay 41) use the sentinel with no secondary: there
// is nothing to draw, so they stay a hole rather than becoming magenta.
assert.equal(overlayFloorHsl(overlay({ primaryRgb: 0xff00ff, secondaryRgb: -1 })), -2,
    "a sentinel overlay without a secondary stays invisible");

console.log("overlay floor colour ok");
