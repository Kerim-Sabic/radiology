import type { TaskType } from '../schema/content';

/** What each kind of task asks, in plain words for lists and cards. It never names the finding, so neutral titles stay neutral. */
export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  find_structure: 'Find a structure',
  navigate_level: 'Find the level',
  follow_structure: 'Follow a structure',
  locate_finding: 'Find the finding',
  choose_window: 'Choose the window',
  describe_finding: 'Describe the finding',
  compare_appearances: 'Compare appearances',
  correlate_modalities: 'Compare two modalities',
  differential: 'Name the diagnosis',
  whole_study: 'Read the whole study',
  not_assessable: 'Can it be read?',
};

export const taskTypeLabel = (type: string | undefined): string => (type ? (TASK_TYPE_LABEL[type as TaskType] ?? type.replace(/_/g, ' ')) : '');
