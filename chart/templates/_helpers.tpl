{{/*
Expand the name of the chart.
*/}}
{{- define "drone-tm.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "drone-tm.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "drone-tm.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "drone-tm.labels" -}}
helm.sh/chart: {{ include "drone-tm.chart" . }}
{{ include "drone-tm.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "drone-tm.selectorLabels" -}}
app.kubernetes.io/name: {{ include "drone-tm.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "drone-tm.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "drone-tm.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Create the name of the backend service
*/}}
{{- define "drone-tm.backend.fullname" -}}
{{- printf "%s-backend" (include "drone-tm.fullname" .) }}
{{- end }}

{{/*
Create the name of the frontend service
*/}}
{{- define "drone-tm.frontend.fullname" -}}
{{- printf "%s-frontend" (include "drone-tm.fullname" .) }}
{{- end }}

{{/*
Create the name of the worker service
*/}}
{{- define "drone-tm.worker.fullname" -}}
{{- printf "%s-worker" (include "drone-tm.fullname" .) }}
{{- end }}

{{/*
Create the name of the qgis service
*/}}
{{- define "drone-tm.qgis.fullname" -}}
{{- printf "%s-qgis" (include "drone-tm.fullname" .) }}
{{- end }}

{{/*
Name of the main app Secret containing env vars
*/}}
{{- define "drone-tm.secretName" -}}
{{- default (printf "%s-secrets" (include "drone-tm.fullname" .)) .Values.existingSecret.name -}}
{{- end }}

{{/*
DragonflyDB service DNS.

DragonflyDB Helm chart names the service:
  {{ .Release.Name }}-dragonfly
*/}}
{{- define "drone-tm.dragonfly.fullname" -}}
{{- $name := "dragonfly" -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end }}

{{- define "drone-tm.dragonfly.serviceName" -}}
{{- include "drone-tm.dragonfly.fullname" . | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{- define "drone-tm.dragonfly.serviceFQDN" -}}
{{- printf "%s.%s.svc.cluster.local" (include "drone-tm.dragonfly.serviceName" .) .Release.Namespace -}}
{{- end }}

{{/*
Render a map of env key/value pairs into a Kubernetes env: list.
Intended for NON-secret values defined in values.yaml.
*/}}
{{- define "drone-tm.renderEnv" -}}
{{- $env := . -}}
{{- range $k := (keys $env | sortAlpha) }}
- name: {{ $k | quote }}
  value: {{ index $env $k | toString | quote }}
{{- end }}
{{- end }}

{{/*
Render env map while omitting keys present in .omit (a map of key->true).
Pass dict:
  - env: map
  - omit: map
*/}}
{{- define "drone-tm.renderEnvOmit" -}}
{{- $env := (.env | default dict) -}}
{{- $omit := (.omit | default dict) -}}
{{- range $k := (keys $env | sortAlpha) }}
{{- if not (hasKey $omit $k) }}
- name: {{ $k | quote }}
  value: {{ index $env $k | toString | quote }}
{{- end }}
{{- end }}
{{- end }}

{{/*
DRY envFrom block: always includes existingSecret plus optional extra refs.
Pass dict:
  - root: the root context (.)
  - extraEnvFrom: list (optional)
*/}}
{{- define "drone-tm.renderEnvFrom" -}}
{{- $root := .root -}}
{{- $extra := (.extraEnvFrom | default list) -}}
envFrom:
  - secretRef:
      name: {{ include "drone-tm.secretName" $root }}
  {{- with $extra }}
  {{- toYaml . | nindent 2 }}
  {{- end }}
{{- end }}
