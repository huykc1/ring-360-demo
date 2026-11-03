// Runs the generator and the simulator off the main thread so the editor stays responsive.
import { generate } from '../core/generate';
import { simulate } from '../core/sim';
import type { GeneratorParams, Level } from '../core/types';

type Request =
    | { kind: 'generate'; job: number; id: string; preset: string; params: GeneratorParams; seed: number }
    | { kind: 'simulate'; job: number; level: Level };

self.onmessage = (e: MessageEvent<Request>) => {
    const r = e.data;
    if (r.kind === 'generate') {
        const res = generate(r.id, r.preset, r.params, r.seed);
        self.postMessage({ job: r.job, kind: 'generate', ...res });
    } else {
        self.postMessage({ job: r.job, kind: 'simulate', sim: simulate(r.level) });
    }
};
