import { describe, expect, it } from 'vitest';
import { extractKm, extractParams, plan } from './rules';

const ALL = new Set(['query_nasa', 'view_globe', 'walkback_check', 'rover_walkback', 'import_walk', 'mars_replay', 'open_evidence', 'explore_hokkaido', 'view_scan', 'view_3d', 'view_overlay', 'view_set_params', 'view_walk']);
const names = (q: string) => plan(q, ALL).map((s) => s.name);

describe('rules agent routing', () => {
  it('maps the five example questions to tools', () => {
    expect(plan('基地から3km先まで歩いて帰れる？', ALL)).toEqual([{ name: 'walkback_check', args: { lang: 'ja', route: { away_km: 3 } } }]);
    expect(names('同じ坂の練習コースを北海道で探して')).toEqual(['walkback_check', 'view_overlay']);
    expect(names('この訓練、北海道のどこでいつやる？')).toEqual(['explore_hokkaido']);
    expect(names('根拠を見せて')).toEqual(['open_evidence', 'open_evidence', 'open_evidence']);
    expect(names('3Dで歩いて見せて')).toEqual(['walkback_check', 'view_3d', 'view_walk']);
  });
  it('takes numbers only from the question', () => {
    expect(extractParams('酸素6時間、冷却水5時間、速さ3km/hで余裕10%')).toEqual({ o2_h: 6, water_h: 5, speed_kmh: 3, reserve: 10 });
    expect(extractParams('Can I walk back with 6 hours of oxygen?')).toEqual({ o2_h: 6 });
    expect(extractKm('速さ3km/hで')).toBeUndefined();
    expect(extractKm('５ｋｍ先')).toBeUndefined(); // full-width digits are normalised in plan(), not here
    expect(plan('５km先まで帰れる？', ALL)[0].args.route).toEqual({ away_km: 5 });
  });
  it('obstacle ahead → report_obstacle with the width from the question', () => {
    const A = new Set([...ALL, 'report_obstacle']);
    expect(plan('前に障害物が横50mにわたってある。ルート再検索して', A)).toEqual([{ name: 'report_obstacle', args: { width_m: 50, lang: 'ja' } }]);
    expect(plan('30m先に岩がある、幅80m。通れないので再検索', A)).toEqual([{ name: 'report_obstacle', args: { width_m: 80, ahead_m: 30, lang: 'ja' } }]);
    expect(plan('Obstacle ahead, 40 m wide. Reroute please', A)).toEqual([{ name: 'report_obstacle', args: { width_m: 40, lang: 'en' } }]);
  });
  it('crewed rover breakdown', () => {
    expect(names('有人ローバーが壊れたら歩いて帰れる？')).toEqual(['rover_walkback']);
    expect(names('酸素4時間でローバーが故障したら？')).toEqual(['view_set_params', 'rover_walkback']);
    expect(names('What if the crewed rover breaks down?')).toEqual(['rover_walkback']);
  });
  it('recorded walk', () => {
    expect(names('歩いた記録で火星を歩いて見せて')).toEqual(['import_walk', 'mars_replay']);
    expect(names('この散歩、火星なら帰れた？')).toEqual(['import_walk']);
  });
  it('counting questions use query_nasa', () => {
    expect(plan('8時間を超えた船外活動は何回？', ALL)[0]).toEqual({ name: 'query_nasa', args: { sql: 'SELECT count(*) AS evas, max(hours) AS longest_h FROM eva WHERE hours > 8' } });
    expect(plan('How far had Perseverance driven by sol 1000?', ALL)[0].args.sql).toMatch(/sol <= 1000/);
  });
  it('the three quick questions', () => {
    expect(plan('2月に氷の試験をしたい', ALL)[0]).toEqual({ name: 'explore_hokkaido', args: { target: 'arcadia', test: 'ice', n: 5 } });
    expect(plan('歩く訓練をしたい', ALL)[0]).toEqual({ name: 'explore_hokkaido', args: { target: 'jezero', test: 'walk', n: 5 } });
    expect(names('ローバーが壊れたら？')).toEqual(['rover_walkback']);
    expect(plan('An ice test in February', ALL)[0].args).toMatchObject({ test: 'ice' });
  });
  it('gazetteer questions use mars_names', () => {
    expect(plan('過去の着陸地点を全部教えて', ALL).find((c) => c.name === 'query_nasa')?.args.sql).toMatch(/kind = 'landing'/);
    expect(plan('有人着陸の候補はどこ？', ALL).find((c) => c.name === 'query_nasa')?.args.sql).toMatch(/kind = 'crewed'/);
    expect(plan('Gusev クレーターはどこ？', ALL).find((c) => c.name === 'query_nasa')?.args.sql).toMatch(/ILIKE '%Gusev%'/);
    expect(plan('Where is Olympus Mons?', ALL)[0].args.sql).toMatch(/ILIKE '%Olympus Mons%'/);
  });
  it('destination ideas use nearby_spots', () => {
    const avail = new Set([...ALL, 'nearby_spots']);
    expect(plan('近くの見どころは？', avail).map((s) => s.name)).toEqual(['nearby_spots']);
    expect(plan('What is worth visiting nearby?', avail)[0]).toEqual({ name: 'nearby_spots', args: { lang: 'en' } });
  });
  it('globe', () => {
    expect(names('火星の全球を見せて')).toEqual(['view_globe']);
  });
  it('bare ground and season keywords', () => {
    expect(plan('火山っぽい裸地で訓練するならどこ？', ALL)[0].args).toMatchObject({ bare_only: true });
    expect(names('冬の様子を見せて')).toEqual(['view_scan']);
    expect(plan('こんにちは', ALL)).toEqual([]);
  });
});
