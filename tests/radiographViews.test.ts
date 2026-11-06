import { describe, expect, it } from 'vitest';
import { hangRadiographs, radiographView, viewNamedIn } from '../src/content/radiographViews';

describe('radiograph views', () => {
  it('reads ViewPosition first', () => {
    expect(radiographView('PA', null, '')).toBe('frontal');
    expect(radiographView('AP', ['P', 'F'], 'lateral')).toBe('frontal');
    expect(radiographView('LL', null, '')).toBe('lateral');
    expect(radiographView('RL', null, '')).toBe('lateral');
  });

  it('then the direction of the image rows (PatientOrientation)', () => {
    // The LIDC "CHEST, PA & LATERAL" series: image 1 rows run to the left, image 2 rows to the back.
    expect(radiographView(undefined, ['L', 'F'], 'CHEST, PA & LATERAL')).toBe('frontal');
    expect(radiographView(undefined, ['P', 'F'], 'CHEST, PA & LATERAL')).toBe('lateral');
    expect(radiographView(undefined, 'R\\F', '')).toBe('frontal');
    expect(radiographView(undefined, 'A\\FL', '')).toBe('lateral');
    // Not a frontal or lateral pattern: not named.
    expect(radiographView(undefined, ['L', 'P'], '')).toBeNull();
  });

  it('then an unambiguous description, never a guess', () => {
    expect(radiographView(null, null, 'Left wrist, lateral')).toBe('lateral');
    expect(radiographView(null, null, 'Left wrist, frontal')).toBe('frontal');
    expect(radiographView(null, null, 'Lateral L')).toBe('lateral');
    expect(radiographView(null, null, 'CHEST, PA & LATERAL')).toBeNull();
    expect(radiographView(null, null, 'CHEST 2 VIEW')).toBeNull();
    expect(radiographView(null, null, '')).toBeNull();
  });

  it('hangs frontal left and lateral right, and keeps the stored order when a view is unknown', () => {
    const a = { id: 'a', view: 'lateral' as const };
    const b = { id: 'b', view: 'frontal' as const };
    const c = { id: 'c', view: null };
    expect(hangRadiographs([a, b]).map((x) => x.id)).toEqual(['b', 'a']);
    expect(hangRadiographs([b, a]).map((x) => x.id)).toEqual(['b', 'a']);
    expect(hangRadiographs([a, c]).map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('finds the view a task names, not anatomy that contains the word', () => {
    expect(viewNamedIn('Find the nodule on the lateral view too')).toBe('lateral');
    expect(viewNamedIn('Mark the fracture on the lateral')).toBe('lateral');
    expect(viewNamedIn('On the PA film, mark the right hilum')).toBe('frontal');
    expect(viewNamedIn('Is the lateral costophrenic angle sharp?')).toBeNull();
    expect(viewNamedIn('Mark the lateral malleolus')).toBeNull();
    expect(viewNamedIn('Mark the effusion')).toBeNull();
  });
});
