import {
  StackstormResult,
  StackstormExecId
} from "../types/stackstorm.d"
import moment, { Duration } from "moment";

export interface StackstormWorkflowTimeline {
  timestamp: Date,
  status: string,
  id: StackstormExecId,
  name: string,
  elapsed: Duration
}

// Function to get all the `log` records from a tree of StackstormResult and
// convert them into one linear sorted list
export const timeline = (workflows: Map<StackstormExecId, StackstormResult<any>>): StackstormWorkflowTimeline[] => {
  const logs = new Array<StackstormWorkflowTimeline>();
  workflows.forEach((result, key) => {
    result.log?.map((l) => logs.push({
      timestamp: new Date(Date.parse(l.timestamp)),
      status: l.status,
      id: key,
      name: result.action.name,
      elapsed: moment.duration(0)
    }));
  });
  const sortedTimeline = logs.sort(
    (objA, objB) => objA.timestamp.getTime() - objB.timestamp.getTime(),
  );
  if (sortedTimeline.length > 0) {
    const start = sortedTimeline[0].timestamp.getTime();
    sortedTimeline.map((l) => l.elapsed = moment.duration(l.timestamp.getTime() - start));
  }
  return sortedTimeline;
}
