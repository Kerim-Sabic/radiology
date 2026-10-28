// vtk.js ships no type declarations for these filters; only the calls used by anatomy3d.ts are typed.
declare module '@kitware/vtk.js/Filters/General/ImageMarchingCubes' {
  const vtkImageMarchingCubes: {
    newInstance(o?: { contourValue?: number; computeNormals?: boolean; mergePoints?: boolean }): {
      setInputData(d: unknown): void;
      getOutputData(): import('@kitware/vtk.js/Common/DataModel/PolyData').vtkPolyData;
    };
  };
  export default vtkImageMarchingCubes;
}
declare module '@kitware/vtk.js/Filters/General/WindowedSincPolyDataFilter' {
  const vtkWindowedSincPolyDataFilter: {
    newInstance(o?: { numberOfIterations?: number; passBand?: number; nonManifoldSmoothing?: number; normalizeCoordinates?: number }): {
      setInputData(d: unknown): void;
      getOutputData(): import('@kitware/vtk.js/Common/DataModel/PolyData').vtkPolyData;
    };
  };
  export default vtkWindowedSincPolyDataFilter;
}
declare module '@kitware/vtk.js/Filters/Core/PolyDataNormals' {
  const vtkPolyDataNormals: {
    newInstance(o?: { computePointNormals?: boolean; computeCellNormals?: boolean }): {
      setInputData(d: unknown): void;
      getOutputData(): import('@kitware/vtk.js/Common/DataModel/PolyData').vtkPolyData;
    };
  };
  export default vtkPolyDataNormals;
}
