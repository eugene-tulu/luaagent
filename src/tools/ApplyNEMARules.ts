import { LuaTool } from 'lua-cli';
import { z } from 'zod';

const InputSchema = z.object({
  project_type: z.enum(['residential', 'commercial', 'industrial', 'road', 'irrigation', 'mining', 'energy']),
  project_scale: z.enum(['small', 'medium', 'large']),
  baseline: z.object({
    land_cover: z.string(),
    slope_percent: z.number(),
    nearest_water_m: z.number().nullable(),
    protected_areas: z.array(z.string())
  })
});

export class ApplyNEMARules implements LuaTool {
  name = 'apply_nema_rules';
  description = 'Apply deterministic Kenyan EMCA/NEMA classification & risk triggers to baseline data';
  inputSchema = InputSchema;

  async execute(input: z.infer<typeof this.inputSchema>) {
    const { project_type, project_scale, baseline } = input;

    let nemaClass = 'Class III - Environmental Audit';
    if (['mining', 'energy'].includes(project_type)) nemaClass = project_scale === 'large' ? 'Class I - Full EIA' : 'Class II - Limited EIA';
    else if (project_type === 'irrigation') nemaClass = project_scale === 'large' ? 'Class I - Full EIA' : 'Class II - Limited EIA';
    else if (['residential', 'commercial', 'road'].includes(project_type)) nemaClass = project_scale === 'large' ? 'Class I - Full EIA' : 'Class II - Limited EIA';

    const triggers: any[] = [];
    if (baseline.nearest_water_m !== null && baseline.nearest_water_m < 30) {
      triggers.push({
        section: 'Water Act 2016, Sec 42 + NEMA Riparian Guidelines',
        severity: baseline.nearest_water_m < 10 ? 'high' : 'medium',
        requirement: `Project within ${baseline.nearest_water_m}m of water. Mandatory WRA permit + ${baseline.nearest_water_m < 10 ? '30m' : '6m'} buffer restoration.`
      });
    }

    if (baseline.slope_percent > 30) {
      triggers.push({
        section: 'EMCA (Impact Assessment) Regulations, 2003, Sch 2',
        severity: 'medium',
        requirement: `Slope ${baseline.slope_percent}% >30% threshold. Geotechnical survey + erosion control plan required.`
      });
    }

    if (baseline.protected_areas.length > 0) {
      triggers.push({
        section: 'Wildlife Conservation Act 2013 + EMCA Sec 55',
        severity: 'high',
        requirement: `Proximity to: ${baseline.protected_areas.join(', ')}. KWS consultation mandatory.`
      });
    }

    const sensitiveCovers = ['wetland', 'forest', 'mangrove', 'swamp'];
    if (sensitiveCovers.includes(baseline.land_cover.toLowerCase())) {
      triggers.push({
        section: 'Forest Act 2016 / Wetlands Policy 2020',
        severity: baseline.land_cover.toLowerCase() === 'wetland' ? 'high' : 'medium',
        requirement: `Sensitive land cover (${baseline.land_cover}). Sectoral conversion permits required.`
      });
    }

    const highRiskCount = triggers.filter(t => t.severity === 'high').length;
    const confidence = highRiskCount === 0 ? 'high' : baseline.nearest_water_m !== null && baseline.slope_percent > 0 ? 'medium' : 'low';
    
    return {
      nema_classification: nemaClass,
      triggers,
      estimated_timeline: nemaClass.includes('I') ? '90-150 days' : nemaClass.includes('II') ? '60-90 days' : '30-45 days',
      confidence,
      next_steps: [
        highRiskCount > 0 ? 'Schedule pre-application meeting with NEMA county office' : 'Proceed with standard PSR/EA preparation',
        'Retain this screening report for NEMA submission file',
        'Disclaimer: Preliminary screening only. Final determination requires licensed EIA practitioner.'
      ]
    };
  }
}