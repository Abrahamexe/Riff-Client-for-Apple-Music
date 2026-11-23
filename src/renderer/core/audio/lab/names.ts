// Worklet ile ana iş parçacığının paylaştığı adlar (worklet paketine yalnızca bu küçük dosya girer).

export const LAB_PROCESSOR = 'riff-audio-lab'
export const LAB_PARAMS = ['clarity', 'air', 'limiter'] as const
export type LabParamName = (typeof LAB_PARAMS)[number]
