import { MATROSKA, MP4, QTFF, WEBM } from 'mediabunny'

/** The containers the site reads video from: MP4 and MOV (phones and cameras), WebM and MKV. Listed, not all, to keep the code small. */
export const VIDEO_FORMATS = [MP4, QTFF, WEBM, MATROSKA]
