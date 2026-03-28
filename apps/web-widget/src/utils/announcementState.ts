interface AnnouncementStateInput {
  loading: boolean;
  loadingMessage: string;
  errorMessage?: string;
  urgentMessage?: string;
  readyMessage?: string;
}

interface AnnouncementState {
  message: string;
  isAlert: boolean;
}

export const buildAnnouncementState = ({
  loading,
  loadingMessage,
  errorMessage,
  urgentMessage,
  readyMessage
}: AnnouncementStateInput): AnnouncementState => {
  if (loading) {
    return { message: loadingMessage, isAlert: false };
  }

  const alertMessage = errorMessage ?? urgentMessage;
  if (alertMessage) {
    return { message: alertMessage, isAlert: true };
  }

  return { message: readyMessage ?? '', isAlert: false };
};
