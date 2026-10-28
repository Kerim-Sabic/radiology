/**
 * One-time Cornerstone3D v5 initialisation (core, tools, DICOM loader, metadata providers).
 * Imported only from lazily-loaded viewer code so the app shell stays small.
 */
import * as cs from '@cornerstonejs/core';
import * as cst from '@cornerstonejs/tools';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import { registerDefaultProviders } from '@cornerstonejs/metadata';

let ready: Promise<{ gpu: boolean }> | null = null;

export const TOOL = {
  WindowLevel: cst.WindowLevelTool.toolName,
  Pan: cst.PanTool.toolName,
  Zoom: cst.ZoomTool.toolName,
  StackScroll: cst.StackScrollTool.toolName,
  Probe: cst.ProbeTool.toolName,
  Arrow: cst.ArrowAnnotateTool.toolName,
  Rectangle: cst.RectangleROITool.toolName,
  Freehand: cst.PlanarFreehandROITool.toolName,
  Length: cst.LengthTool.toolName,
  Angle: cst.AngleTool.toolName,
  Ellipse: cst.EllipticalROITool.toolName,
  Eraser: cst.EraserTool.toolName,
  Crosshairs: cst.CrosshairsTool.toolName,
  TrackballRotate: cst.TrackballRotateTool.toolName,
  Magnify: cst.MagnifyTool.toolName,
} as const;

/** Tools whose annotations are learner marks (graded / saved). */
export const MARK_TOOLS = new Set<string>([TOOL.Probe, TOOL.Arrow, TOOL.Rectangle, TOOL.Freehand]);
/** Measurement tools (not graded marks). */
export const MEASURE_TOOLS = new Set<string>([TOOL.Length, TOOL.Angle, TOOL.Ellipse]);

/** Hook installed by the UI to collect a label when an arrow is placed. */
export const arrowLabelHook: { request: ((done: (text: string) => void) => void) | null } = { request: null };

export function initCornerstone(): Promise<{ gpu: boolean }> {
  if (ready) return ready;
  ready = (async () => {
    registerDefaultProviders();
    cs.metaData.addProvider(
      cs.utilities.calibratedPixelSpacingMetadataProvider.get.bind(cs.utilities.calibratedPixelSpacingMetadataProvider),
      11000,
    );
    dicomImageLoader.init({ maxWebWorkers: Math.max(1, Math.min(navigator.hardwareConcurrency || 2, 4)) });
    cs.volumeLoader.registerUnknownVolumeLoader(cs.cornerstoneStreamingImageVolumeLoader as never);
    cs.volumeLoader.registerVolumeLoader('cornerstoneStreamingImageVolume', cs.cornerstoneStreamingImageVolumeLoader as never);
    await cs.init();
    await cst.init();
    for (const T of [
      cst.WindowLevelTool,
      cst.PanTool,
      cst.ZoomTool,
      cst.StackScrollTool,
      cst.ProbeTool,
      cst.ArrowAnnotateTool,
      cst.RectangleROITool,
      cst.PlanarFreehandROITool,
      cst.LengthTool,
      cst.AngleTool,
      cst.EllipticalROITool,
      cst.EraserTool,
      cst.CrosshairsTool,
      cst.TrackballRotateTool,
      cst.MagnifyTool,
    ]) {
      cst.addTool(T as never);
    }
    const gpu = !cs.getShouldUseCPURendering();
    return { gpu };
  })();
  return ready;
}

export { cs, cst, dicomImageLoader };

// Inspection handle for automated acceptance tests.
(window as unknown as { __cs: unknown }).__cs = { cs, cst };
