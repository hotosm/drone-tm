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
Create the name of the ODM services
*/}}
{{- define "drone-tm.odm.nodeodm.fullname" -}}
{{- printf "%s-odm-nodeodm" (include "drone-tm.fullname" .) }}
{{- end }}

{{- define "drone-tm.odm.webodm.fullname" -}}
{{- printf "%s-odm-webodm" (include "drone-tm.fullname" .) }}
{{- end }}

{{- define "drone-tm.odm.worker.fullname" -}}
{{- printf "%s-odm-worker" (include "drone-tm.fullname" .) }}
{{- end }}

