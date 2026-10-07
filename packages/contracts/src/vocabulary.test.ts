import { describe, expect, it } from 'vitest';
import { MODELS, MODEL_IDS, modelId } from './vocabulary';

describe('MODEL_IDS', () => {
  it('maps each model card to its Decision D10 id', () => {
    expect(MODEL_IDS).toEqual({ opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-4-5' });
    expect(MODELS.map(modelId)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']);
  });

  it('has an id for every model and no others', () => {
    expect(Object.keys(MODEL_IDS).sort()).toEqual([...MODELS].sort());
  });
});
