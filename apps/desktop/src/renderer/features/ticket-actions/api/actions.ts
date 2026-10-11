import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { Lane, MoveStageResponse, SetWorkItemStateRequest } from '@agent-lanes/contracts';
import { adoKeys, invoke, ticketRecordQueryKey, unwrap } from '@/shared/api';
import { LANE_LABELS } from '@/shared/config';
import { toast } from '@/shared/model';

/** A drop of an agent card on a lane (AL-274): the stage move, with a toast when it fails; null then. */
export function useMoveStageOnDrop(): (ticketId: string, lane: Lane) => Promise<MoveStageResponse | null> {
  const queryClient = useQueryClient();
  return useCallback(
    async (ticketId, lane) => {
      if (lane === 'queued') return null;
      try {
        const moved = unwrap(await invoke('agent:moveStage', { ticketId, stage: lane }));
        void queryClient.invalidateQueries({ queryKey: ticketRecordQueryKey(ticketId) });
        return moved;
      } catch (error) {
        toast({ id: `move-stage:${ticketId}`, tone: 'error', title: `Couldn't move it to ${LANE_LABELS[lane]}`, body: error instanceof Error ? error.message : String(error) });
        return null;
      }
    },
    [queryClient],
  );
}

/** Move to stage… (AL-270): the user's own lane move; the card follows the `agent:stage` event. */
export function useMoveStage(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (stage: Exclude<Lane, 'queued'>) => unwrap(await invoke('agent:moveStage', { ticketId, stage })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ticketRecordQueryKey(ticketId) }),
  });
}

/** Change ADO state… (AL-270): the work item's state, behind the modal's confirm; its card reads the item again. */
export function useSetWorkItemState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: SetWorkItemStateRequest) => unwrap(await invoke('ado:setWorkItemState', request)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adoKeys.all }),
  });
}
