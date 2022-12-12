import Head from 'next/head'
import styles from '../styles/Home.module.css'
import { useEffect, useState } from "react"
import { Box } from '@mui/material'
import {
  executeStackstormAction,
  StackstormExecId,
  StackstormResult
} from "../utils/stackstorm"
import {
  timeline,
  StackstormWorkflowTimeline,
} from "../utils/stackstormTimeline";
import * as React from 'react';
import Timeline from '@mui/lab/Timeline';
import TimelineItem from '@mui/lab/TimelineItem';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import TimelineOppositeContent, { timelineOppositeContentClasses, } from '@mui/lab/TimelineOppositeContent';
import TimelineDot from '@mui/lab/TimelineDot';
import moment from 'moment'
//import CircularProgress from '@mui/material/CircularProgress';

const Stackstorm = (props: any) => {
  const [workflow, setWorkflow] = useState<Map<StackstormExecId, StackstormResult<any>>>(new Map());

  const foo = (e: any) => {
    console.log("callback", e);
    setWorkflow(new Map(workflow.set(e.id, e.result)));
  };

  useEffect(() => {
    executeStackstormAction<any>({ action: props.action, parameters: props.params }, foo);
  }, []);

  return (<Box sx={{ width: 1 }}>
    < Timeline sx={{
      [`& .${timelineOppositeContentClasses.root}`]: {
        flex: 0.8,
      },
    }
    }>
      {
        timeline(workflow).map((l: StackstormWorkflowTimeline, i: number, log: StackstormWorkflowTimeline[]) =>
        (
          <TimelineItem key={i}>
            <TimelineOppositeContent color="textSecondary">{moment.utc(l.elapsed.as('milliseconds')).format('HH:mm:ss.SSS')}</TimelineOppositeContent>
            <TimelineSeparator>
              <TimelineDot />
              {(i == log.length - 1
                //  && workflow?.result?.status !== "running"
              ) ? <></> : <TimelineConnector />
              }
            </TimelineSeparator>
            <TimelineContent><span>{l.status} {l.name} {l.id}</span></TimelineContent>
          </TimelineItem>
        ))
      }
      {//workflow?.result?.status === "running" ?
        // (
        //   <TimelineItem key={"activity"}>
        //     <TimelineSeparator>
        //       <TimelineDot>
        //         <Box sx={{ display: 'flex' }}>
        //           <CircularProgress />
        //         </Box>
        //       </TimelineDot>
        //     </TimelineSeparator>
        //   </TimelineItem>
        // ) : (
        //   <></>
        //)
      }

    </Timeline >
  </Box>);
}

export default function Home() {
  return (
    <div className={styles.container}>
      <Head>
        <title>Stackstorm API Demo with Xstate and Timeline</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className={styles.main}>
        <div>
          <Stackstorm action="<<< put your stackstorm action ref here >>>" params={{ << < put your stackstorm action parameters here >>> }} />
          </div>
      </main>

    </div>
  )
}
