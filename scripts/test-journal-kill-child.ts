import { JournalWriter } from './benchmarks/journalIO';
import { runJournalGame } from './benchmarks/matchJournal';
import { fixtureStart, fixtureSearch } from './benchmarks/journalFixtures';

const start=fixtureStart(); start.conditions.maxPlies=20;
const writer=new JournalWriter(process.argv[2],start.conditions.maxBytes);
try {
  runJournalGame(start,writer,fixtureSearch,undefined,ply => {
    if(ply===3) {
      process.send?.({committed:ply});
      // The parent kills this live process while the next search has not started.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000);
    }
  });
} finally { writer.close(); }
