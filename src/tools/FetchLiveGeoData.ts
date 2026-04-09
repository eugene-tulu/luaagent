import { LuaTool } from 'lua-cli';
import { z } from 'zod';

const InputSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  location_name: z.string().optional()
});

export class FetchLiveGeoData implements LuaTool {
  name = 'fetch_live_geo_data';
  description = 'Live-browse GeoContextualize via TinyFish to extract real-time environmental baseline metrics';
  inputSchema = InputSchema;

  async execute(input: z.infer<typeof this.inputSchema>) {
    const startTime = Date.now();
    const tinyfishKey = process.env.TINYFISH_API_KEY;
    if (!tinyfishKey) throw new Error('TINYFISH_API_KEY missing');

    try {
      const runRes = await fetch('https://agent.tinyfish.ai/v1/runs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tinyfishKey}`
        },
        body: JSON.stringify({
          url: process.env.GEOCONTEXTUALIZE_URL!,
          goal: `
            1. Enter coordinates ${input.lat}, ${input.lon} into the location search
            2. Trigger analysis and wait for full results panel
            3. Extract ALL visible metrics into STRICT JSON:
            {
              "location_name": "${input.location_name || 'Unknown'}",
              "land_cover": "string (e.g., cropland, settlement, forest, wetland)",
              "elevation_m": number,
              "ndvi": number or null,
              "slope_percent": number,
              "nearest_water_m": number or null,
              "protected_areas": ["array of strings or empty"]
            }
            4. Return ONLY valid JSON. No markdown. No extra text.
          `,
          output_format: 'json',
          timeout: 150,
          browser_profile: 'stealth'
        })
      });

      if (!runRes.ok) {
        const err = await runRes.text();
        throw new Error(`TinyFish run failed: ${runRes.status} ${err}`);
      }

      const runData = await runRes.json();
      const runId = runData.id || runData.run_id;
      if (!runId) throw new Error('No run_id returned from TinyFish');

      let attempts = 0;
      const maxAttempts = 45;
      let result: any = null;

      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 2000));
        attempts++;

        const statusRes = await fetch(`https://agent.tinyfish.ai/v1/runs/${runId}`, {
          headers: { 'Authorization': `Bearer ${tinyfishKey}` }
        });

        if (!statusRes.ok) throw new Error('Failed to poll run status');
        const status = await statusRes.json();

        if (status.status === 'COMPLETED') {
          result = typeof status.output === 'string' ? JSON.parse(status.output) : status.output;
          break;
        }
        if (status.status === 'FAILED') {
          throw new Error(status.error || 'Agent execution failed');
        }
      }

      if (!result) throw new Error('Agent timed out waiting for GeoContextualize results');

      const baseline = {
        location_name: result.location_name || `${input.lat.toFixed(4)}, ${input.lon.toFixed(4)}`,
        land_cover: String(result.land_cover || 'unknown'),
        elevation_m: Number(result.elevation_m) || 0,
        ndvi: result.ndvi !== undefined ? Number(result.ndvi) : null,
        slope_percent: Number(result.slope_percent) || 0,
        nearest_water_m: result.nearest_water_m !== undefined ? Number(result.nearest_water_m) : null,
        protected_areas: Array.isArray(result.protected_areas) ? result.protected_areas : []
      };

      return {
        success: true,
        baseline,
        audit: {
          run_id: runId,
          source_url: process.env.GEOCONTEXTUALIZE_URL!,
          extraction_time_ms: Date.now() - startTime,
          raw_output: JSON.stringify(result).substring(0, 500)
        }
      };

    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown extraction error',
        audit: { run_id: 'failed', source_url: process.env.GEOCONTEXTUALIZE_URL!, extraction_time_ms: Date.now() - startTime, raw_output: '' }
      };
    }
  }
}