{{- define "leadpilot.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "leadpilot.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "leadpilot.selector" -}}
app.kubernetes.io/name: {{ .root.Chart.Name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "leadpilot.tag" -}}
{{- .Values.image.tag | default .Chart.AppVersion -}}
{{- end -}}

{{- define "leadpilot.secretName" -}}
{{- .Values.existingSecret | default (printf "%s-secrets" (include "leadpilot.fullname" .)) -}}
{{- end -}}

{{/* Environment shared by api, worker and the migration job */}}
{{- define "leadpilot.env" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.database.existingSecret | default (include "leadpilot.secretName" .) }}
      key: DATABASE_URL
- name: REDIS_URL
  value: {{ .Values.redis.url | quote }}
{{- end -}}

{{- define "leadpilot.envFrom" -}}
- configMapRef:
    name: {{ include "leadpilot.fullname" . }}-config
- secretRef:
    name: {{ include "leadpilot.secretName" . }}
    optional: true
{{- end -}}

{{- define "leadpilot.securityContext" -}}
runAsNonRoot: true
runAsUser: 1000
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: [ALL]
{{- end -}}
