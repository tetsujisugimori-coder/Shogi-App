import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createInitialBoardState, BoardState, BoardSquare, Piece, PieceType } from '../../types/shogi';
import {
  executeDrop,
  evaluateAgreedJishogi,
  evaluateEnteringKingDeclaration,
  executeEnteringKingDeclaration,
  executeMove,
  proposeAgreedJishogi,
  respondToAgreedJishogiProposal,
  executeResignation,
  createShogiGameRecordFilename,
  createKifFileName,
  createKifText,
  downloadShogiGameRecord,
  downloadKifText,
  getLegalDropSquares,
  getMoveCandidates,
  getPromotionStatus,
  getPositionSnapshot,
  addGameRecordSessionBranch,
  createGameRecordSession,
  discardGameRecordSession,
  storeGameRecordSessionState,
  switchGameRecordSessionToBranch,
  switchGameRecordSessionToMainline,
  normalizePositionSnapshots,
  serializeShogiGameRecordSessionV1,
  importShogiGameRecordSession,
  importKifBytes,
  MAX_SHOGI_GAME_RECORD_SESSION_FILE_BYTES,
  MAX_KIF_FILE_BYTES,
  PromotionStatus,
  type ShogiGameRecordSessionImportResult,
  type KifImportResult,
  type AgreedJishogiProposal,
  type GameRecordSession,
} from '../../domain/shogi';
import { ShogiTable } from './ShogiTable';
import { PromotionDialog } from './PromotionDialog';
import { ResignationDialog } from './ResignationDialog';
import { EnteringKingDeclarationDialog } from './EnteringKingDeclarationDialog';
import { AgreedJishogiDialog } from './AgreedJishogiDialog';
import { NewGameDialog } from './NewGameDialog';
import { MoveHistoryPanel } from './MoveHistoryPanel';
import { getGameResultDisplay } from './gameResultDisplay';
import { GameRecordImportDialog } from './GameRecordImportDialog';
import { KifImportDialog } from './KifImportDialog';
import { BranchReplayDialog } from './BranchReplayDialog';

interface ShogiResearchScreenProps {
  initialState?: BoardState;
}

interface PendingPromotion {
  from: { row: number; col: number };
  to: { row: number; col: number };
  status: Exclude<PromotionStatus, 'none'>;
}

interface PendingGameRecordImport {
  filename: string;
  session: GameRecordSession;
  state: BoardState;
  metadata: Extract<ShogiGameRecordSessionImportResult, { ok: true }>['metadata'];
}

interface PendingKifImport {
  filename: string;
  state: BoardState;
  metadata: Extract<KifImportResult, { ok: true }>['metadata'];
}

type SelectionState =
  | { kind: 'none' }
  | { kind: 'board'; square: { row: number; col: number } }
  | { kind: 'hand'; pieceId: string; pieceType: PieceType };

const STATUS_BADGE_COLORS = {
  neutral: {
    bgColor: 'bg-stone-900/80 text-stone-300 border-stone-700/60',
    dotColor: 'bg-stone-500',
  },
  amber: {
    bgColor: 'bg-amber-950/80 text-amber-200 border-amber-700/60',
    dotColor: 'bg-amber-400',
  },
  sky: {
    bgColor: 'bg-sky-950/80 text-sky-200 border-sky-700/60',
    dotColor: 'bg-sky-400',
  },
  rose: {
    bgColor: 'bg-rose-950/80 text-rose-300 border-rose-800/60',
    dotColor: 'bg-rose-500',
  },
} as const;

export const ShogiResearchScreen: React.FC<ShogiResearchScreenProps> = ({ initialState }) => {
  const [boardState, setBoardState] = useState<BoardState>(() =>
    normalizePositionSnapshots(initialState ?? createInitialBoardState())
  );
  const [replayHistoryIndex, setReplayHistoryIndex] = useState<number | null>(null);
  const [gameRecordSession, setGameRecordSession] = useState<GameRecordSession | null>(null);
  const [pendingBranchHistoryIndex, setPendingBranchHistoryIndex] = useState<number | null>(null);
  const [isReturnToMainlineDialogOpen, setIsReturnToMainlineDialogOpen] = useState(false);
  const [selection, setSelection] = useState<SelectionState>({ kind: 'none' });
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [isResignationDialogOpen, setIsResignationDialogOpen] = useState(false);
  const [isEnteringKingDialogOpen, setIsEnteringKingDialogOpen] = useState(false);
  const [isAgreedJishogiDialogOpen, setIsAgreedJishogiDialogOpen] = useState(false);
  const [isNewGameDialogOpen, setIsNewGameDialogOpen] = useState(false);
  const [pendingGameRecordImport, setPendingGameRecordImport] =
    useState<PendingGameRecordImport | null>(null);
  const [isGameRecordFileReading, setIsGameRecordFileReading] = useState(false);
  const [pendingKifImport, setPendingKifImport] = useState<PendingKifImport | null>(null);
  const [isKifFileReading, setIsKifFileReading] = useState(false);
  const [moveHistoryResetKey, setMoveHistoryResetKey] = useState(0);
  const [agreedJishogiProposal, setAgreedJishogiProposal] = useState<AgreedJishogiProposal | null>(null);
  const [agreedJishogiError, setAgreedJishogiError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<
    { kind: 'success' | 'error'; message: string } | null
  >(null);
  const [focusRequest, setFocusRequest] = useState<{
    row: number;
    col: number;
    requestId: number;
  } | null>(null);
  const focusRequestId = useRef(0);
  const resignationButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreResignationFocus = useRef(false);
  const enteringKingButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreEnteringKingFocus = useRef(false);
  const agreedJishogiButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreAgreedJishogiFocus = useRef(false);
  const newGameButtonRef = useRef<HTMLButtonElement>(null);
  const branchStartButtonRef = useRef<HTMLButtonElement>(null);
  const returnToMainlineButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreBranchStartFocus = useRef(false);
  const shouldRestoreMainlineFocus = useRef(false);
  const shouldRestoreNewGameFocus = useRef(false);
  const gameRecordImportButtonRef = useRef<HTMLButtonElement>(null);
  const gameRecordFileInputRef = useRef<HTMLInputElement>(null);
  const shouldRestoreGameRecordImportFocus = useRef(false);
  const kifImportButtonRef = useRef<HTMLButtonElement>(null);
  const kifFileInputRef = useRef<HTMLInputElement>(null);
  const shouldRestoreKifImportFocus = useRef(false);

  const replaySnapshot =
    replayHistoryIndex === null
      ? null
      : getPositionSnapshot(boardState, replayHistoryIndex);
  const isViewingReplay = replaySnapshot !== null;
  const activeSessionBranch = (() => {
    if (!gameRecordSession || gameRecordSession.selection.kind !== 'branch') return null;
    const activeRecordId = gameRecordSession.selection.recordId;
    return gameRecordSession.branches.find((branch) => branch.state.recordId === activeRecordId) ?? null;
  })();
  const dialogsAreOpen =
    pendingPromotion !== null ||
    isResignationDialogOpen ||
    isEnteringKingDialogOpen ||
    isAgreedJishogiDialogOpen ||
    isNewGameDialogOpen ||
    pendingBranchHistoryIndex !== null ||
    isReturnToMainlineDialogOpen ||
    pendingGameRecordImport !== null ||
    isGameRecordFileReading ||
    pendingKifImport !== null ||
    isKifFileReading;
  const isEnded = boardState.status === 'ended';
  const isResignationAvailable = boardState.status === 'active' || boardState.status === 'check';
  const isEnteringKingAvailable = boardState.status === 'active' || boardState.status === 'check';
  const isNewGameAvailable = isEnteringKingAvailable || isEnded;
  const isInteractionBlocked = isEnded || isViewingReplay || dialogsAreOpen;
  const selectedSquare =
    !isEnded && !isViewingReplay && selection.kind === 'board' ? selection.square : null;
  const selectedHandPieceId =
    !isEnded && !isViewingReplay && selection.kind === 'hand' ? selection.pieceId : null;

  const replayIndexes = useMemo(
    () =>
      [...new Set((boardState.positionSnapshots ?? []).map((snapshot) => snapshot.historyIndex))]
        .filter((index) => getPositionSnapshot(boardState, index) !== null)
        .sort((left, right) => left - right),
    [boardState]
  );
  const replayIndexSet = useMemo(() => new Set(replayIndexes), [replayIndexes]);
  const replayPosition = replayHistoryIndex === null ? -1 : replayIndexes.indexOf(replayHistoryIndex);
  const replayBaselineIndex = replayHistoryIndex ?? boardState.history.length;
  const previousReplayIndex =
    replayIndexes.filter((index) => index < replayBaselineIndex).at(-1) ?? null;
  const nextReplayIndex =
    replayPosition >= 0 && replayPosition < replayIndexes.length - 1
      ? replayIndexes[replayPosition + 1]
      : null;
  const canStartBranch =
    gameRecordSession?.selection.kind !== 'branch' &&
    !boardState.branchFrom &&
    isViewingReplay &&
    replayHistoryIndex !== null &&
    replayHistoryIndex < boardState.history.length;

  // Compute candidates for the mutually exclusive board/hand selection.
  const candidateSquares = useMemo(() => {
    if (boardState.status === 'ended' || isViewingReplay) return [];
    if (selection.kind === 'board') {
      return getMoveCandidates(boardState.squares, selection.square, boardState.turn);
    }
    if (selection.kind === 'hand') {
      return getLegalDropSquares(boardState, selection.pieceId);
    }
    return [];
  }, [boardState, isViewingReplay, selection]);

  const enteringKingEvaluation = useMemo(
    () => evaluateEnteringKingDeclaration(boardState),
    [boardState]
  );
  const agreedJishogiEvaluation = useMemo(
    () => evaluateAgreedJishogi(boardState),
    [boardState]
  );

  useEffect(() => {
    if (boardState.status !== 'ended') return;
    setSelection({ kind: 'none' });
    setPendingPromotion(null);
    setIsResignationDialogOpen(false);
    setIsEnteringKingDialogOpen(false);
    setIsAgreedJishogiDialogOpen(false);
    setAgreedJishogiProposal(null);
    setAgreedJishogiError(null);
  }, [boardState.status]);

  useEffect(() => {
    if (isResignationDialogOpen || !shouldRestoreResignationFocus.current) return;
    shouldRestoreResignationFocus.current = false;
    resignationButtonRef.current?.focus();
  }, [isResignationDialogOpen]);

  useEffect(() => {
    if (isEnteringKingDialogOpen || !shouldRestoreEnteringKingFocus.current) return;
    shouldRestoreEnteringKingFocus.current = false;
    enteringKingButtonRef.current?.focus();
  }, [isEnteringKingDialogOpen]);

  useEffect(() => {
    if (isAgreedJishogiDialogOpen || !shouldRestoreAgreedJishogiFocus.current) return;
    shouldRestoreAgreedJishogiFocus.current = false;
    agreedJishogiButtonRef.current?.focus();
  }, [isAgreedJishogiDialogOpen]);

  useEffect(() => {
    if (isNewGameDialogOpen || !shouldRestoreNewGameFocus.current) return;
    shouldRestoreNewGameFocus.current = false;
    newGameButtonRef.current?.focus();
  }, [isNewGameDialogOpen]);

  useEffect(() => {
    if (pendingBranchHistoryIndex !== null || !shouldRestoreBranchStartFocus.current) return;
    shouldRestoreBranchStartFocus.current = false;
    branchStartButtonRef.current?.focus();
  }, [pendingBranchHistoryIndex]);

  useEffect(() => {
    if (isReturnToMainlineDialogOpen || !shouldRestoreMainlineFocus.current) return;
    shouldRestoreMainlineFocus.current = false;
    returnToMainlineButtonRef.current?.focus();
  }, [isReturnToMainlineDialogOpen]);

  useEffect(() => {
    if (pendingGameRecordImport || !shouldRestoreGameRecordImportFocus.current) return;
    shouldRestoreGameRecordImportFocus.current = false;
    gameRecordImportButtonRef.current?.focus();
  }, [pendingGameRecordImport]);

  useEffect(() => {
    if (pendingKifImport || !shouldRestoreKifImportFocus.current) return;
    shouldRestoreKifImportFocus.current = false;
    kifImportButtonRef.current?.focus();
  }, [pendingKifImport]);

  const restoreBoardFocus = useCallback((square: { row: number; col: number }) => {
    focusRequestId.current += 1;
    setFocusRequest({ ...square, requestId: focusRequestId.current });
  }, []);

  const selectReplayPosition = useCallback(
    (historyIndex: number) => {
      if (dialogsAreOpen || !getPositionSnapshot(boardState, historyIndex)) return;
      setSelection({ kind: 'none' });
      setFocusRequest(null);
      setReplayHistoryIndex(historyIndex);
    },
    [boardState, dialogsAreOpen]
  );

  const returnToCurrentPosition = useCallback(() => {
    setReplayHistoryIndex(null);
    setSelection({ kind: 'none' });
    setFocusRequest(null);
  }, []);

  const cancelBranchStart = useCallback(() => {
    shouldRestoreBranchStartFocus.current = true;
    setPendingBranchHistoryIndex(null);
  }, []);

  const openBranchStartDialog = useCallback(() => {
    if (
      activeSessionBranch !== null ||
      boardState.branchFrom ||
      !canStartBranch ||
      replayHistoryIndex === null ||
      dialogsAreOpen
    ) {
      return;
    }
    setPendingBranchHistoryIndex(replayHistoryIndex);
  }, [activeSessionBranch, boardState.branchFrom, canStartBranch, dialogsAreOpen, replayHistoryIndex]);

  const confirmBranchStart = () => {
    if (
      activeSessionBranch !== null ||
      boardState.branchFrom ||
      pendingBranchHistoryIndex === null
    ) {
      setPendingBranchHistoryIndex(null);
      return;
    }
    const session = gameRecordSession ?? createGameRecordSession(boardState);
    const started = addGameRecordSessionBranch(session, boardState, pendingBranchHistoryIndex);
    if (!started.ok || !started.boardState) {
      setPendingBranchHistoryIndex(null);
      return;
    }
    focusRequestId.current = 0;
    setGameRecordSession(started.session);
    setBoardState(started.boardState);
    setReplayHistoryIndex(null);
    setSelection({ kind: 'none' });
    setPendingPromotion(null);
    setIsResignationDialogOpen(false);
    setIsEnteringKingDialogOpen(false);
    setIsAgreedJishogiDialogOpen(false);
    setAgreedJishogiProposal(null);
    setAgreedJishogiError(null);
    setFocusRequest(null);
    setMoveHistoryResetKey((current) => current + 1);
    setPendingBranchHistoryIndex(null);
  };

  const cancelReturnToMainline = useCallback(() => {
    shouldRestoreMainlineFocus.current = true;
    setIsReturnToMainlineDialogOpen(false);
  }, []);

  const confirmReturnToMainline = () => {
    if (!gameRecordSession || !activeSessionBranch) return;
    const result = switchGameRecordSessionToMainline(gameRecordSession, boardState);
    if (!result.ok || !result.boardState) return;
    focusRequestId.current = 0;
    setGameRecordSession(result.session);
    setBoardState(result.boardState);
    setReplayHistoryIndex(null);
    setSelection({ kind: 'none' });
    setPendingPromotion(null);
    setIsResignationDialogOpen(false);
    setIsEnteringKingDialogOpen(false);
    setIsAgreedJishogiDialogOpen(false);
    setAgreedJishogiProposal(null);
    setAgreedJishogiError(null);
    setFocusRequest(null);
    setMoveHistoryResetKey((current) => current + 1);
    setIsReturnToMainlineDialogOpen(false);
  };

  const openReturnToMainlineDialog = () => {
    if (activeSessionBranch && !dialogsAreOpen) setIsReturnToMainlineDialogOpen(true);
  };

  const switchToSessionBranch = (branchId: string) => {
    if (!gameRecordSession || dialogsAreOpen) return;
    const result = switchGameRecordSessionToBranch(gameRecordSession, boardState, branchId);
    if (!result.ok || !result.boardState) return;

    focusRequestId.current = 0;
    setGameRecordSession(result.session);
    setBoardState(result.boardState);
    setReplayHistoryIndex(null);
    setSelection({ kind: 'none' });
    setPendingPromotion(null);
    setAgreedJishogiProposal(null);
    setAgreedJishogiError(null);
    setFocusRequest(null);
    setMoveHistoryResetKey((current) => current + 1);
  };

  const cancelPromotion = useCallback(() => {
    if (!pendingPromotion) return;
    const restoreSquare = pendingPromotion.from;
    setPendingPromotion(null);
    setSelection({ kind: 'none' });
    restoreBoardFocus(restoreSquare);
  }, [pendingPromotion, restoreBoardFocus]);

  const completePromotionChoice = (promotion: 'promote' | 'decline') => {
    if (!pendingPromotion) return;

    const result = executeMove(boardState, pendingPromotion.from, pendingPromotion.to, {
      mode: 'assist',
      proposer: 'human',
      promotion,
    });

    if (result.type === 'applied') {
      setBoardState(result.state);
    }

    const restoreSquare = result.type === 'applied' ? pendingPromotion.to : pendingPromotion.from;
    setPendingPromotion(null);
    setSelection({ kind: 'none' });
    restoreBoardFocus(restoreSquare);
  };

  const openResignationDialog = () => {
    if (
      !isResignationAvailable ||
      pendingPromotion ||
      isResignationDialogOpen ||
      isEnteringKingDialogOpen ||
      isAgreedJishogiDialogOpen ||
      isNewGameDialogOpen
    ) return;
    setIsResignationDialogOpen(true);
  };

  const cancelResignation = useCallback(() => {
    shouldRestoreResignationFocus.current = true;
    setIsResignationDialogOpen(false);
  }, []);

  const confirmResignation = () => {
    const result = executeResignation(boardState);
    if (result.type === 'applied') {
      setBoardState(result.state);
      setSelection({ kind: 'none' });
      setPendingPromotion(null);
    }
    setIsResignationDialogOpen(false);
  };

  const openEnteringKingDialog = () => {
    if (
      !isEnteringKingAvailable ||
      pendingPromotion ||
      isResignationDialogOpen ||
      isEnteringKingDialogOpen ||
      isAgreedJishogiDialogOpen ||
      isNewGameDialogOpen
    ) return;
    setIsEnteringKingDialogOpen(true);
  };

  const cancelEnteringKing = useCallback(() => {
    shouldRestoreEnteringKingFocus.current = true;
    setIsEnteringKingDialogOpen(false);
  }, []);

  const confirmEnteringKing = () => {
    const result = executeEnteringKingDeclaration(boardState, {
      mode: 'assist',
      proposer: 'human',
    });
    if (result.type === 'applied') {
      setBoardState(result.state);
      setSelection({ kind: 'none' });
      setPendingPromotion(null);
    }
    setIsEnteringKingDialogOpen(false);
  };

  const openAgreedJishogiDialog = () => {
    if (
      !isEnteringKingAvailable ||
      pendingPromotion ||
      isResignationDialogOpen ||
      isEnteringKingDialogOpen ||
      isAgreedJishogiDialogOpen ||
      isNewGameDialogOpen
    ) return;
    setAgreedJishogiProposal(null);
    setAgreedJishogiError(null);
    setIsAgreedJishogiDialogOpen(true);
  };

  const closeAgreedJishogiDialog = useCallback(() => {
    shouldRestoreAgreedJishogiFocus.current = true;
    setAgreedJishogiProposal(null);
    setAgreedJishogiError(null);
    setIsAgreedJishogiDialogOpen(false);
  }, []);

  const confirmAgreedJishogiProposal = () => {
    const execution = proposeAgreedJishogi(boardState, boardState.turn);
    if (execution.type === 'proposed') {
      setAgreedJishogiProposal(execution.proposal);
      setAgreedJishogiError(null);
      return;
    }
    setAgreedJishogiError(execution.message);
  };

  const rejectAgreedJishogiProposal = () => {
    if (agreedJishogiProposal) {
      respondToAgreedJishogiProposal(
        boardState,
        agreedJishogiProposal,
        agreedJishogiProposal.responder,
        'reject'
      );
    }
    closeAgreedJishogiDialog();
  };

  const acceptAgreedJishogiProposal = () => {
    if (!agreedJishogiProposal) return;
    const execution = respondToAgreedJishogiProposal(
      boardState,
      agreedJishogiProposal,
      agreedJishogiProposal.responder,
      'accept'
    );
    if (execution.type === 'accepted') {
      setBoardState(execution.state);
      setAgreedJishogiProposal(null);
      setAgreedJishogiError(null);
      setIsAgreedJishogiDialogOpen(false);
      return;
    }
    if (execution.type === 'rejected') {
      setAgreedJishogiError(execution.message);
    }
  };

  const openNewGameDialog = () => {
    if (
      !isNewGameAvailable ||
      pendingPromotion ||
      isResignationDialogOpen ||
      isEnteringKingDialogOpen ||
      isAgreedJishogiDialogOpen ||
      isNewGameDialogOpen
    ) return;
    setIsNewGameDialogOpen(true);
  };

  const cancelNewGame = useCallback(() => {
    shouldRestoreNewGameFocus.current = true;
    setIsNewGameDialogOpen(false);
  }, []);

  const confirmNewGame = () => {
    shouldRestoreResignationFocus.current = false;
    shouldRestoreEnteringKingFocus.current = false;
    shouldRestoreAgreedJishogiFocus.current = false;
    shouldRestoreNewGameFocus.current = true;
    focusRequestId.current = 0;

    setBoardState(createInitialBoardState());
    setGameRecordSession(discardGameRecordSession());
    setReplayHistoryIndex(null);
    setSelection({ kind: 'none' });
    setPendingPromotion(null);
    setIsResignationDialogOpen(false);
    setIsEnteringKingDialogOpen(false);
    setIsAgreedJishogiDialogOpen(false);
    setAgreedJishogiProposal(null);
    setAgreedJishogiError(null);
    setFocusRequest(null);
    setMoveHistoryResetKey((current) => current + 1);
    setIsNewGameDialogOpen(false);
  };

  const saveGameRecord = () => {
    const exportedAt = new Date();
    try {
      const session = storeGameRecordSessionState(
        gameRecordSession ?? createGameRecordSession(boardState),
        boardState
      );
      const json = serializeShogiGameRecordSessionV1(session, exportedAt);
      const filename = createShogiGameRecordFilename(exportedAt);
      downloadShogiGameRecord(json, filename);
      setExportNotice({ kind: 'success', message: `対局記録を保存しました（${filename}）` });
    } catch {
      setExportNotice({
        kind: 'error',
        message: '対局記録を保存できませんでした。時間をおいてもう一度お試しください。',
      });
    }
  };

  const saveKifRecord = () => {
    const exportedAt = new Date();

    try {
      const kifText = createKifText(boardState);
      const filename = createKifFileName(exportedAt);
      downloadKifText(kifText, filename);
      setExportNotice({ kind: 'success', message: 'KIF棋譜を保存しました（' + filename + '）' });
    } catch {
      setExportNotice({
        kind: 'error',
        message: 'KIF棋譜を保存できませんでした。時間をおいてもう一度お試しください。',
      });
    }
  };

  const selectGameRecordFile = () => {
    if (dialogsAreOpen || isGameRecordFileReading) return;
    gameRecordFileInputRef.current?.click();
  };

  const handleGameRecordFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file || dialogsAreOpen || isGameRecordFileReading) return;
    if (file.size > MAX_SHOGI_GAME_RECORD_SESSION_FILE_BYTES) {
      setExportNotice({
        kind: 'error',
        message: '研究セッションファイルが大きすぎます（上限128 MiB）。',
      });
      return;
    }
    setIsGameRecordFileReading(true);
    setExportNotice(null);
    try {
      const json = await file.text();
      const result = importShogiGameRecordSession(json);
      if (!result.ok) {
        setExportNotice({ kind: 'error', message: result.message });
        return;
      }
      setPendingGameRecordImport({
        filename: file.name,
        session: result.session,
        state: result.state,
        metadata: result.metadata,
      });
    } catch {
      setExportNotice({
        kind: 'error',
        message: '対局記録ファイルを読み取れませんでした。別のファイルを選択してください。',
      });
    } finally {
      setIsGameRecordFileReading(false);
    }
  };

  const cancelGameRecordImport = useCallback(() => {
    shouldRestoreGameRecordImportFocus.current = true;
    setPendingGameRecordImport(null);
  }, []);

  const selectKifFile = () => {
    if (dialogsAreOpen || isKifFileReading) return;
    kifFileInputRef.current?.click();
  };

  const handleKifFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file || dialogsAreOpen || isKifFileReading) return;
    if (file.size > MAX_KIF_FILE_BYTES) {
      setExportNotice({ kind: 'error', message: 'KIFファイルが大きすぎます（上限32 MiB）。' });
      return;
    }
    setIsKifFileReading(true);
    setExportNotice(null);
    try {
      const bytes = await file.arrayBuffer();
      const result = importKifBytes(bytes);
      if (!result.ok) {
        setExportNotice({ kind: 'error', message: result.message });
        return;
      }
      setPendingKifImport({ filename: file.name, state: result.state, metadata: result.metadata });
    } catch {
      setExportNotice({ kind: 'error', message: 'KIFファイルを読み取れませんでした。別のファイルを選択してください。' });
    } finally {
      setIsKifFileReading(false);
    }
  };

  const cancelKifImport = useCallback(() => {
    shouldRestoreKifImportFocus.current = true;
    setPendingKifImport(null);
  }, []);

  const confirmKifImport = () => {
    if (!pendingKifImport) return;
    focusRequestId.current = 0;
    setBoardState(pendingKifImport.state);
    setGameRecordSession(discardGameRecordSession());
    setReplayHistoryIndex(null);
    setSelection({ kind: 'none' });
    setPendingPromotion(null);
    setAgreedJishogiProposal(null);
    setAgreedJishogiError(null);
    setFocusRequest(null);
    setMoveHistoryResetKey((current) => current + 1);
    shouldRestoreKifImportFocus.current = true;
    setExportNotice({ kind: 'success', message: `KIF棋譜を読み込みました（${pendingKifImport.filename}）` });
    setPendingKifImport(null);
  };

  const confirmGameRecordImport = () => {
    if (!pendingGameRecordImport) return;
    shouldRestoreResignationFocus.current = false;
    shouldRestoreEnteringKingFocus.current = false;
    shouldRestoreAgreedJishogiFocus.current = false;
    shouldRestoreNewGameFocus.current = false;
    shouldRestoreGameRecordImportFocus.current = true;
    focusRequestId.current = 0;
    setBoardState(pendingGameRecordImport.state);
    setGameRecordSession(pendingGameRecordImport.session);
    setReplayHistoryIndex(null);
    setSelection({ kind: 'none' });
    setPendingPromotion(null);
    setIsResignationDialogOpen(false);
    setIsEnteringKingDialogOpen(false);
    setIsAgreedJishogiDialogOpen(false);
    setIsNewGameDialogOpen(false);
    setAgreedJishogiProposal(null);
    setAgreedJishogiError(null);
    setFocusRequest(null);
    setMoveHistoryResetKey((current) => current + 1);
    setExportNotice({
      kind: 'success',
      message: `対局記録を読み込みました（${pendingGameRecordImport.filename}）`,
    });
    setPendingGameRecordImport(null);
  };

  const handleSquareClick = (square: BoardSquare) => {
    if (isInteractionBlocked) return;
    if (selection.kind === 'hand') {
      if (square.piece?.player === boardState.turn) {
        setSelection({ kind: 'board', square: { row: square.row, col: square.col } });
        return;
      }

      const isDropCandidate = candidateSquares.some(
        (candidate) => candidate.row === square.row && candidate.col === square.col
      );
      if (!isDropCandidate) return;

      const result = executeDrop(
        boardState,
        selection.pieceId,
        { row: square.row, col: square.col },
        { mode: 'assist', proposer: 'human' }
      );
      if (result.type === 'applied') {
        setBoardState(result.state);
        setSelection({ kind: 'none' });
        restoreBoardFocus({ row: square.row, col: square.col });
      }
      return;
    }

    // Case 1: No square currently selected
    if (!selectedSquare) {
      if (square.piece && square.piece.player === boardState.turn) {
        setSelection({ kind: 'board', square: { row: square.row, col: square.col } });
      }
      return;
    }

    // Case 2: Clicked on already selected square -> Deselect
    if (selectedSquare.row === square.row && selectedSquare.col === square.col) {
      setSelection({ kind: 'none' });
      return;
    }

    // Case 3: Clicked on another own piece -> Switch selection
    if (square.piece && square.piece.player === boardState.turn) {
      setSelection({ kind: 'board', square: { row: square.row, col: square.col } });
      return;
    }

    // Case 4: Clicked on a legal move candidate square -> Execute move
    const isCandidate = candidateSquares.some(
      (c) => c.row === square.row && c.col === square.col
    );

    if (isCandidate) {
      const from = selectedSquare;
      const to = { row: square.row, col: square.col };
      const movingPiece = boardState.squares[from.row][from.col].piece;
      if (!movingPiece) return;
      const promotionStatus = getPromotionStatus(movingPiece, from, to);

      if (promotionStatus !== 'none') {
        setPendingPromotion({ from, to, status: promotionStatus });
        return;
      }

      const result = executeMove(boardState, from, to, {
        mode: 'assist',
        proposer: 'human',
      });
      if (result.type === 'applied') {
        setBoardState(result.state);
      }
      setSelection({ kind: 'none' });
      return;
    }

    // Case 5: Clicked on an invalid square (opponent piece, empty non-candidate, etc.) -> Do nothing
  };

  const handleHandPieceSelect = (piece: Piece) => {
    if (isInteractionBlocked || piece.player !== boardState.turn) {
      return;
    }
    setSelection((current) =>
      current.kind === 'hand' && current.pieceId === piece.id
        ? { kind: 'none' }
        : { kind: 'hand', pieceId: piece.id, pieceType: piece.type }
    );
  };

  const handleScreenKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (dialogsAreOpen) return;
    if (event.key === 'Escape' && selection.kind === 'hand') {
      event.preventDefault();
      setSelection({ kind: 'none' });
    }
  };

  const displayedTurn = replaySnapshot?.turn ?? boardState.turn;
  const turnLabel = displayedTurn === 'sente' ? '先手番' : '後手番';

  const statusBadgeInfo = useMemo(() => {
    if (replaySnapshot) {
      const positionLabel =
        replaySnapshot.historyIndex === 0
          ? '初期局面を閲覧中'
          : `${replaySnapshot.historyIndex}手目終了局面を閲覧中`;
      return {
        text: `${positionLabel} / 次は${turnLabel}${replaySnapshot.status === 'check' ? ' / 王手' : ''}`,
        isLive: false,
        bgColor: 'bg-sky-950/80 text-sky-200 border-sky-700/60',
        dotColor: 'bg-sky-400',
      };
    }

    if (boardState.status === 'ended' && boardState.result) {
      const display = getGameResultDisplay(boardState.result);
      return {
        text: `終局 / ${display.statusText}`,
        isLive: false,
        ...STATUS_BADGE_COLORS[display.tone],
      };
    }

    if (boardState.status === 'check') {
      return {
        text: `王手 / ${turnLabel}`,
        isLive: true,
        bgColor: 'bg-rose-950/70 text-rose-300 border-rose-800/50',
        dotColor: 'bg-rose-400',
      };
    }

    return {
      text: `対局中 / ${turnLabel}`,
      isLive: true,
      bgColor: 'bg-amber-950/70 text-amber-300 border-amber-800/50',
      dotColor: 'bg-amber-400',
    };
  }, [boardState.status, boardState.result, replaySnapshot, turnLabel]);

  return (
    <div
      id="shogi-research-screen"
      data-turn={boardState.turn}
      data-move-number={boardState.moveNumber}
      data-history-count={boardState.history.length}
      data-foul-history-count={boardState.foulHistory?.length ?? 0}
      data-position-history-count={boardState.positionHistory?.length ?? 0}
      data-sente-hand-count={boardState.senteHand.length}
      data-gote-hand-count={boardState.goteHand.length}
      data-last-move={boardState.lastMove?.notation ?? ''}
      data-result={boardState.result?.endReason ?? ''}
      data-move-limit-jishogi={boardState.moveLimitJishogi?.kind ?? ''}
      data-position-snapshot-count={boardState.positionSnapshots?.length ?? 0}
      data-replay-history-index={replayHistoryIndex ?? ''}
      data-branch-origin-history-index={activeSessionBranch?.originHistoryIndex ?? ''}
      data-session-branch-count={gameRecordSession?.branches.length ?? 0}
      data-active-session-record={
        activeSessionBranch?.state.recordId ?? (boardState.branchFrom ? 'standalone-branch' : 'mainline')
      }
      onKeyDown={handleScreenKeyDown}
      className="min-h-full w-full flex flex-col items-center justify-between py-6 px-3 sm:px-6 bg-[#0f1115] text-stone-200"
    >
      {/* Top Header Section */}
      <header className="w-full max-w-4xl flex flex-col items-center text-center gap-2 mb-6">
        <div className="flex items-center gap-3">
          <h1
            id="shogi-screen-title"
            className="text-2xl sm:text-3xl font-serif font-bold text-amber-100 tracking-wider"
            style={{
              fontFamily:
                '"Yu Mincho", "Hiragino Mincho ProN", "YuMincho", "MS PMincho", "Noto Serif JP", serif',
            }}
          >
            将棋研究
          </h1>
          <span
            id="shogi-status-badge"
            className={`inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-medium ${statusBadgeInfo.bgColor} border shadow-inner`}
            role="status"
            aria-live="polite"
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${statusBadgeInfo.dotColor} ${statusBadgeInfo.isLive ? 'animate-pulse' : ''}`}
            />
            {statusBadgeInfo.text}
          </span>
        </div>

        <p
          id="shogi-screen-description"
          className="text-xs sm:text-sm text-stone-400 font-sans tracking-wide max-w-xl"
        >
          AIとの対局・棋譜・判断ログを記録する研究画面です。
        </p>
        <div className="mt-2 flex max-w-full flex-wrap justify-center gap-2">
          {activeSessionBranch && (
            <button
              ref={returnToMainlineButtonRef}
              type="button"
              onClick={openReturnToMainlineDialog}
              disabled={dialogsAreOpen}
              aria-haspopup="dialog"
              aria-expanded={isReturnToMainlineDialogOpen}
              className="rounded border border-sky-700/70 bg-sky-950/45 px-4 py-1.5 font-serif text-sm tracking-[0.1em] text-sky-100 shadow-inner outline-none transition hover:border-sky-500 hover:bg-sky-900/55 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-65"
            >
              本譜へ戻る
            </button>
          )}
          <button
            ref={enteringKingButtonRef}
            type="button"
            onClick={openEnteringKingDialog}
            disabled={!isEnteringKingAvailable || isViewingReplay || dialogsAreOpen}
            aria-haspopup="dialog"
            aria-expanded={isEnteringKingDialogOpen}
            className="rounded border border-amber-700/70 bg-amber-950/45 px-4 py-1.5 font-serif text-sm tracking-[0.12em] text-amber-100 shadow-inner outline-none transition hover:border-amber-500 hover:bg-amber-900/55 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:border-stone-800 disabled:text-stone-600 disabled:opacity-65"
          >
            入玉宣言
          </button>
          <button
            ref={agreedJishogiButtonRef}
            type="button"
            onClick={openAgreedJishogiDialog}
            disabled={!isEnteringKingAvailable || isViewingReplay || dialogsAreOpen}
            aria-haspopup="dialog"
            aria-expanded={isAgreedJishogiDialogOpen}
            className="rounded border border-sky-800/70 bg-sky-950/45 px-4 py-1.5 font-serif text-sm tracking-[0.1em] text-sky-100 shadow-inner outline-none transition hover:border-sky-600 hover:bg-sky-900/55 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:border-stone-800 disabled:text-stone-600 disabled:opacity-65"
          >
            持将棋を提案
          </button>
          <button
            ref={resignationButtonRef}
            type="button"
            onClick={openResignationDialog}
            disabled={!isResignationAvailable || isViewingReplay || dialogsAreOpen}
            aria-haspopup="dialog"
            aria-expanded={isResignationDialogOpen}
            className="rounded border border-rose-900/70 bg-stone-900/80 px-4 py-1.5 font-serif text-sm tracking-[0.14em] text-rose-200 shadow-inner outline-none transition hover:border-rose-700 hover:bg-rose-950/55 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:border-stone-800 disabled:text-stone-600 disabled:opacity-65"
          >
            投了
          </button>
          <button
            type="button"
            onClick={saveGameRecord}
            disabled={dialogsAreOpen}
            className="rounded border border-violet-800/70 bg-violet-950/45 px-4 py-1.5 font-serif text-sm tracking-[0.1em] text-violet-100 shadow-inner outline-none transition hover:border-violet-600 hover:bg-violet-900/55 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:border-stone-800 disabled:text-stone-600 disabled:opacity-65"
          >
              対局記録を保存
            </button>
            <button
              type="button"
              onClick={saveKifRecord}
              disabled={dialogsAreOpen}
              className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              KIF棋譜を保存
            </button>
          <input
            ref={kifFileInputRef}
            id="shogi-kif-file-input"
            type="file"
            accept=".kif,text/plain"
            className="sr-only"
            tabIndex={-1}
            aria-labelledby="shogi-kif-import-button"
            onChange={handleKifFileChange}
          />
          <button
            ref={kifImportButtonRef}
            id="shogi-kif-import-button"
            type="button"
            onClick={selectKifFile}
            disabled={dialogsAreOpen || isKifFileReading}
            aria-controls="shogi-kif-file-input"
            aria-haspopup="dialog"
            aria-expanded={pendingKifImport !== null}
            className="rounded border border-amber-700/70 bg-amber-950/45 px-4 py-1.5 font-serif text-sm tracking-[0.1em] text-amber-100 shadow-inner outline-none transition hover:border-amber-500 hover:bg-amber-900/55 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:border-stone-800 disabled:text-stone-600 disabled:opacity-65"
          >
            {isKifFileReading ? 'KIF棋譜を検証中' : 'KIF棋譜を読み込む'}
          </button>
          <input
            ref={gameRecordFileInputRef}
            id="shogi-game-record-file-input"
            type="file"
            accept=".json,application/json"
            className="sr-only"
            tabIndex={-1}
            aria-labelledby="shogi-game-record-import-button"
            onChange={handleGameRecordFileChange}
          />
          <button
            ref={gameRecordImportButtonRef}
            id="shogi-game-record-import-button"
            type="button"
            onClick={selectGameRecordFile}
            disabled={dialogsAreOpen || isGameRecordFileReading}
            aria-controls="shogi-game-record-file-input"
            aria-haspopup="dialog"
            aria-expanded={pendingGameRecordImport !== null}
            className="rounded border border-violet-800/70 bg-violet-950/45 px-4 py-1.5 font-serif text-sm tracking-[0.1em] text-violet-100 shadow-inner outline-none transition hover:border-violet-600 hover:bg-violet-900/55 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:border-stone-800 disabled:text-stone-600 disabled:opacity-65"
          >
            {isGameRecordFileReading ? '対局記録を検証中' : '対局記録を読み込む'}
          </button>
          <button
            ref={newGameButtonRef}
            type="button"
            onClick={openNewGameDialog}
            disabled={!isNewGameAvailable || isViewingReplay || dialogsAreOpen}
            aria-haspopup="dialog"
            aria-expanded={isNewGameDialogOpen}
            className="rounded border border-emerald-800/70 bg-emerald-950/45 px-4 py-1.5 font-serif text-sm tracking-[0.1em] text-emerald-100 shadow-inner outline-none transition hover:border-emerald-600 hover:bg-emerald-900/55 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:border-stone-800 disabled:text-stone-600 disabled:opacity-65"
          >
            新しい対局
          </button>
        </div>
        {activeSessionBranch && (
          <p className="mt-1 text-xs text-sky-200" role="status">
            検討手順: {activeSessionBranch.displayName}
          </p>
        )}
        {(gameRecordSession?.branches.length ?? 0) > 0 && (
          <section
            className="mt-2 w-full max-w-2xl rounded border border-sky-900/70 bg-sky-950/20 px-3 py-2 text-left"
            aria-labelledby="session-records-title"
            aria-describedby="session-records-description"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id="session-records-title" className="font-serif text-sm tracking-[0.1em] text-sky-100">
                本譜と検討手順
              </h2>
              <p id="session-records-description" className="text-xs text-stone-400">
                このセッションの検討手順はJSONの対局記録としてまとめて保存・再読込できます。
              </p>
            </div>
            <div className="mt-2 flex flex-wrap gap-2" role="list">
              <div role="listitem">
                <button
                  type="button"
                  onClick={openReturnToMainlineDialog}
                  disabled={activeSessionBranch === null || dialogsAreOpen}
                  aria-current={activeSessionBranch === null ? 'page' : undefined}
                  className="rounded border border-amber-700/70 bg-amber-950/35 px-3 py-1 text-sm text-amber-100 outline-none transition hover:bg-amber-900/50 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-65"
                >
                  本譜
                </button>
              </div>
              {gameRecordSession?.branches.map((branch) => (
                <div key={branch.state.recordId} role="listitem">
                  <button
                    type="button"
                    onClick={() => branch.state.recordId && switchToSessionBranch(branch.state.recordId)}
                    disabled={
                      !branch.state.recordId ||
                      branch.state.recordId === activeSessionBranch?.state.recordId ||
                      dialogsAreOpen
                    }
                    aria-current={
                      branch.state.recordId === activeSessionBranch?.state.recordId ? 'page' : undefined
                    }
                    className="rounded border border-sky-700/70 bg-sky-950/45 px-3 py-1 text-sm text-sky-100 outline-none transition hover:bg-sky-900/60 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-65"
                  >
                    {branch.displayName}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
        {exportNotice && (
          <p
            role={exportNotice.kind === 'error' ? 'alert' : 'status'}
            aria-live={exportNotice.kind === 'error' ? 'assertive' : 'polite'}
            className={`mt-1 max-w-full break-words text-xs ${
              exportNotice.kind === 'error' ? 'text-rose-300' : 'text-emerald-300'
            }`}
          >
            {exportNotice.message}
          </p>
        )}
      </header>

      {/* Main Table Section */}
      <main className="flex w-full max-w-[76rem] flex-1 min-w-0 flex-col items-center justify-center gap-4 md:gap-6 xl:flex-row xl:items-start">
        <div className="w-full min-w-0 max-w-4xl xl:flex-1">
          <ShogiTable
            squares={replaySnapshot?.squares ?? boardState.squares}
            senteHand={replaySnapshot?.senteHand ?? boardState.senteHand}
            goteHand={replaySnapshot?.goteHand ?? boardState.goteHand}
            status={replaySnapshot?.status ?? boardState.status}
            viewMode={boardState.viewMode}
            selectedSquare={selectedSquare}
            candidateSquares={candidateSquares}
            candidateKind={selection.kind === 'none' ? null : selection.kind === 'hand' ? 'drop' : 'move'}
            dropPieceType={selection.kind === 'hand' ? selection.pieceType : null}
            lastMove={replaySnapshot ? replaySnapshot.lastMove : boardState.lastMove}
            onSquareClick={isInteractionBlocked ? undefined : handleSquareClick}
            focusRequest={focusRequest}
            turn={displayedTurn}
            selectedHandPieceId={selectedHandPieceId}
            onHandPieceSelect={handleHandPieceSelect}
            pieceStandsDisabled={isInteractionBlocked}
          />
        </div>
        <MoveHistoryPanel
          history={boardState.history}
          result={!isViewingReplay && boardState.status === 'ended' ? boardState.result : null}
          resetKey={moveHistoryResetKey}
          availableHistoryIndexes={replayIndexSet}
          currentHistoryIndex={replayHistoryIndex}
          selectionDisabled={dialogsAreOpen}
          canGoToInitial={replayIndexSet.has(0) && replayHistoryIndex !== 0}
          canGoToPrevious={previousReplayIndex !== null}
          canGoToNext={nextReplayIndex !== null}
          isViewingReplay={isViewingReplay}
          canStartBranch={canStartBranch}
          onStartBranch={openBranchStartDialog}
          branchStartButtonRef={branchStartButtonRef}
          onSelectHistoryIndex={selectReplayPosition}
          onGoToInitial={() => selectReplayPosition(0)}
          onGoToPrevious={() => {
            if (previousReplayIndex !== null) selectReplayPosition(previousReplayIndex);
          }}
          onGoToNext={() => {
            if (nextReplayIndex !== null) selectReplayPosition(nextReplayIndex);
          }}
          onReturnToCurrent={returnToCurrentPosition}
        />
      </main>

      {pendingPromotion && !isEnded && (
        <PromotionDialog
          status={pendingPromotion.status}
          onPromote={() => completePromotionChoice('promote')}
          onDecline={() => completePromotionChoice('decline')}
          onCancel={cancelPromotion}
        />
      )}

      {isResignationDialogOpen && !isEnded && (
        <ResignationDialog
          resigningPlayer={boardState.turn}
          onConfirm={confirmResignation}
          onCancel={cancelResignation}
        />
      )}

      {isEnteringKingDialogOpen && !isEnded && (
        <EnteringKingDeclarationDialog
          evaluation={enteringKingEvaluation}
          onConfirm={confirmEnteringKing}
          onCancel={cancelEnteringKing}
        />
      )}

      {isAgreedJishogiDialogOpen && !isEnded && (
        <AgreedJishogiDialog
          evaluation={agreedJishogiEvaluation}
          proposal={agreedJishogiProposal}
          errorMessage={agreedJishogiError}
          onPropose={confirmAgreedJishogiProposal}
          onCancel={closeAgreedJishogiDialog}
          onAccept={acceptAgreedJishogiProposal}
          onReject={rejectAgreedJishogiProposal}
        />
      )}

      {isNewGameDialogOpen && (
        <NewGameDialog onConfirm={confirmNewGame} onCancel={cancelNewGame} />
      )}

      {pendingBranchHistoryIndex !== null && (
        <BranchReplayDialog
          kind="start"
          historyIndex={pendingBranchHistoryIndex}
          onConfirm={confirmBranchStart}
          onCancel={cancelBranchStart}
        />
      )}

      {isReturnToMainlineDialogOpen && activeSessionBranch && (
        <BranchReplayDialog
          kind="return"
          onConfirm={confirmReturnToMainline}
          onCancel={cancelReturnToMainline}
        />
      )}

      {pendingGameRecordImport && (
        <GameRecordImportDialog
          filename={pendingGameRecordImport.filename}
          exportedAt={pendingGameRecordImport.metadata.exportedAt}
          moveCount={pendingGameRecordImport.metadata.moveCount}
          isEnded={pendingGameRecordImport.metadata.isEnded}
          onConfirm={confirmGameRecordImport}
          onCancel={cancelGameRecordImport}
        />
      )}

      {pendingKifImport && (
        <KifImportDialog
          filename={pendingKifImport.filename}
          moveCount={pendingKifImport.metadata.moveCount}
          isEnded={pendingKifImport.metadata.isEnded}
          encoding={pendingKifImport.metadata.encoding}
          onConfirm={confirmKifImport}
          onCancel={cancelKifImport}
        />
      )}

      {/* Bottom Footer Notice */}
      <footer className="w-full max-w-4xl mt-8 pt-4 border-t border-stone-800/60 text-center">
        <p
          id="shogi-footer-notice"
          className="text-xs text-stone-400 font-sans tracking-wide select-none"
        >
          駒の移動・成り・駒打ち、王手表示・一般的な詰み判定・終局処理に対応しています。千日手・連続王手の千日手の終局処理に対応しています。500手規定による持将棋の終局処理に対応しています。合意による持将棋の終局処理に対応しています。投了による終局処理に対応しています。入玉宣言による終局処理に対応しています。確認後に平手初期局面から新しい対局を始められます。
        </p>
      </footer>
    </div>
  );
};
