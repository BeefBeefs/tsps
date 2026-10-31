import assert from "node:assert/strict";
import { test } from "node:test";
import { BuildSteps, finishBuild } from "../common/utils/BuildSteps";
import { Scene } from "../rs/scene/Scene";
import { SceneTile } from "../rs/scene/SceneTile";
import { SceneTileModel } from "../rs/scene/SceneTileModel";
import { SceneBuffer } from "../render/buffer/SceneBuffer";

test("worker steps accept cancellation between units and release unfinished state", async (t) => {
    let clock = 0, units = 0, released = false;
    t.mock.method(performance, "now", () => clock);
    const controller = new AbortController();
    function* build() {
        try {
            for (let i = 0; i < 100; i++) { units++; clock += 4; yield; }
            return "complete";
        } finally { released = true; }
    }
    const work = new BuildSteps(controller.signal).run(build());
    assert.equal(units, 2, "pause after the time budget, before draining the whole square");
    controller.abort();
    await assert.rejects(work, { name: "AbortError" });
    assert.equal(units, 2, "cancellation must not process another unit");
    assert.equal(released, true);
});

test("8x8 terrain steps retain exact geometry, both LODs and border coordinates", async () => {
    const size = 16, border = 6;
    const scene = new Scene(4, size + border * 2, size + border * 2);
    for (let x = 0; x < scene.sizeX; x++) for (let y = 0; y < scene.sizeY; y++) {
        const tile = new SceneTile(0, x, y);
        tile.tileModel = new SceneTileModel(0, 0, -1, x, y, 0, 0, 0, 0,
            96, 96, 96, 96, 10000, 10000, 10000, 10000, 10000, 10000, 0, 0);
        scene.tiles[0][x][y] = tile;
    }
    const whole = new SceneBuffer({} as any, new Map(), 128);
    const stepped = new SceneBuffer({} as any, new Map(), 128);
    const expected = whole.addTerrain(scene, border, 3, size);
    const steps = stepped.addTerrainSteps(scene, border, 3, size);
    assert.equal(steps.next().done, false);
    assert.equal(stepped.indices.length, 0, "the first chunk is a deferred work unit");
    steps.next();
    assert.equal(stepped.drawCommands.length, 1);
    assert.deepEqual(stepped.drawCommands[0].chunk, [0, 0]);
    assert.equal(stepped.drawCommands[0].elements, 8 * 8 * 6, "one step packs one 8x8 chunk");
    assert.equal(await new BuildSteps().run(steps), expected);
    assert.deepEqual(stepped.vertexBuf.byteArray(), whole.vertexBuf.byteArray());
    assert.deepEqual(stepped.indices, whole.indices);
    assert.deepEqual(stepped.drawCommands, whole.drawCommands);
    assert.deepEqual(stepped.drawCommandsLod, whole.drawCommandsLod);
});


test("warm complete square builds preserve every geometry byte and scene metadata", async () => {
    const { CacheSystem } = await import("../rs/cache/CacheSystem");
    const { getCacheLoaderFactory } = await import("../rs/cache/loader/CacheLoaderFactory");
    const { LocModelLoader } = await import("../rs/config/loctype/LocModelLoader");
    const { VarManager } = await import("../rs/config/vartype/VarManager");
    const { SceneBuilder } = await import("../rs/scene/SceneBuilder");
    const { MinimapImageRenderer } = await import("../rs/map/MinimapImageRenderer");
    const { SdMapDataLoader } = await import("../render/loader/SdMapDataLoader");
    const { Hasher } = await import("../common/utils/Hasher");
    const { loadCache, loadCacheInfos, loadCacheList } = await import("../scripts/cache/load-util");
    await Hasher.init();
    const cache = loadCache(loadCacheList(loadCacheInfos()).latest);
    const cacheSystem = CacheSystem.fromFiles(cache.info, cache.files);
    const factory = getCacheLoaderFactory(cache.info, cacheSystem);
    const locTypeLoader = factory.getLocTypeLoader(), textureLoader = factory.getTextureLoader();
    const locModelLoader = new LocModelLoader(locTypeLoader, factory.getModelLoader(), textureLoader,
        factory.getSeqTypeLoader(), factory.getSeqFrameLoader(), factory.getSkeletalSeqLoader());
    const state: any = { cache, cacheSystem, locTypeLoader, textureLoader, locModelLoader,
        varManager: new VarManager(factory.getVarBitTypeLoader()), npcInstances: [],
        sceneBuilder: new SceneBuilder(cache.info, factory.getMapFileLoader(), factory.getUnderlayTypeLoader(),
            factory.getOverlayTypeLoader(), locTypeLoader, locModelLoader, cache.xteas),
        minimapImageRenderer: new MinimapImageRenderer(locTypeLoader, factory.getMapScenes()),
    };
    const loader = new SdMapDataLoader();
    const input = { mapX: 50, mapY: 50, maxLevel: 3, loadNpcs: false, smoothTerrain: true,
        minimizeDrawCalls: true, minimapLevel: 0, loadedTextureIds: new Set<number>() };
    const immediate = new BuildSteps();
    immediate.run = async steps => finishBuild(steps);
    await loader.load(state, input, immediate);
    const expected = await loader.load(state, input, immediate);
    const actual = await loader.load(state, input, new BuildSteps());
    assert.deepEqual(actual.data, expected.data, "yielding cannot change geometry, minimaps, bridge flags or picking metadata");

    const castleInput = { ...input, mapX: 37, mapY: 48,
        extraLocs: [{ id: 4444, x: 2411, y: 3080, level: 0, shape: 4, rotation: 0 }] };
    const castle = await loader.load(state, castleInput, immediate);
    const ropeReload = await loader.load(state, { ...castleInput, locOnly: true }, immediate);
    assert.ok(Buffer.from(ropeReload.data!.loc.vertices).equals(Buffer.from(castle.data!.loc.vertices)),
        "a rope's loc-only reload keeps the castle's merged wall lighting");
    assert.ok(Buffer.from(ropeReload.data!.loc.indices.buffer).equals(Buffer.from(castle.data!.loc.indices.buffer)));
});

test("pool skips cancelled queued jobs and forwards cancellation to a running worker", async () => {
    const { RenderDataWorkerPool } = await import("../game/worker/RenderDataWorkerPool");
    let dispatch!: (worker: any) => Promise<unknown>;
    const pool = new RenderDataWorkerPool({ queue: (task: typeof dispatch) => { dispatch = task; return {}; } } as any, [], 1);
    const queued = new AbortController();
    pool.queueLoad({} as any, {}, queued.signal);
    queued.abort();
    await assert.rejects(dispatch({ load: () => assert.fail("cancelled jobs never reach a worker") }), { name: "AbortError" });

    const active = new AbortController();
    let requestId: number | undefined, cancelId: number | undefined;
    let reject!: (reason: unknown) => void;
    pool.queueLoad({} as any, {}, active.signal);
    const pending = dispatch({
        load: (_loader: unknown, _input: unknown, id: number) => {
            requestId = id;
            return new Promise((_resolve, no) => { reject = no; });
        },
        cancelLoad: async (id: number) => { cancelId = id; reject(active.signal.reason); },
    });
    active.abort();
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(cancelId, requestId, "only the dispatched job is cancelled");
});

test("a blended instance floor is drawn although the map has no underlay", async () => {
    const { CacheSystem } = await import("../rs/cache/CacheSystem");
    const { getCacheLoaderFactory } = await import("../rs/cache/loader/CacheLoaderFactory");
    const { LocModelLoader } = await import("../rs/config/loctype/LocModelLoader");
    const { SceneBuilder } = await import("../rs/scene/SceneBuilder");
    const { loadCache, loadCacheInfos, loadCacheList } = await import("../scripts/cache/load-util");
    const cache = loadCache(loadCacheList(loadCacheInfos()).latest);
    const cacheSystem = CacheSystem.fromFiles(cache.info, cache.files);
    const factory = getCacheLoaderFactory(cache.info, cacheSystem);
    const locTypeLoader = factory.getLocTypeLoader(), textureLoader = factory.getTextureLoader();
    const locModelLoader = new LocModelLoader(locTypeLoader, factory.getModelLoader(), textureLoader,
        factory.getSeqTypeLoader(), factory.getSeqFrameLoader(), factory.getSkeletalSeqLoader());
    const sceneBuilder = new SceneBuilder(cache.info, factory.getMapFileLoader(), factory.getUnderlayTypeLoader(),
        factory.getOverlayTypeLoader(), locTypeLoader, locModelLoader, cache.xteas);

    // The Ancient Vault's instance palette (DesertTreasureII.Quest.js): plane 1 of
    // cache chunks 490..493 x 1202..1205 into the first 4x4 chunks of the scene.
    // Its floor overlays use the 0xFF00FF blend sentinel and the map has no
    // underlay, so the secondary colour is the only ground colour that exists.
    const pack = (plane: number, chunkX: number, chunkY: number) =>
        ((plane & 3) << 24) | ((chunkX & 0x3ff) << 14) | ((chunkY & 0x7ff) << 3);
    const palette: number[][][] = Array.from({ length: 4 }, () =>
        Array.from({ length: 13 }, () => new Array<number>(13).fill(-1)));
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) palette[1][x][y] = pack(1, 490 + x, 1202 + y);

    const scene: Scene = await finishBuild(
        sceneBuilder.buildInstanceSceneSteps(palette, 0, 0, 104, 104, false));
    assert.ok(scene.tiles[1][20][20]?.tileModel?.faces.length! > 0,
        "the vault floor tile draws its secondary colour instead of staying a hole");
    assert.equal(scene.tiles[1][0][0]?.tileModel?.faces.length ?? 0, 0,
        "the sentinel-only void around the room stays empty");

    const terrain = new SceneBuffer(textureLoader, new Map(), 100000);
    assert.ok(terrain.addTerrain(scene, 0, 3, 104, 0) > 0,
        "the instance's floor reaches the terrain mesh");
    assert.ok(terrain.drawCommands.some(command => command.instances[0].level === 1),
        "the floor is drawn on the instance's own plane");
});
