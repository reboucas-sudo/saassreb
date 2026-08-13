--
-- PostgreSQL database dump
--

\restrict a3Xrnira5iI6RCRbQQZHxelI1OupmlEvNB6yoXRjN1YAKKpMc8w5nB1aQcCoeeI

-- Dumped from database version 16.4
-- Dumped by pg_dump version 18.3

-- Started on 2026-08-13 16:57:43

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 114 (class 2615 OID 2200)
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- TOC entry 6408 (class 0 OID 0)
-- Dependencies: 114
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- TOC entry 1385 (class 1247 OID 57660)
-- Name: tipo_operador_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.tipo_operador_enum AS ENUM (
    'Montagem/Embalagem',
    'Injetoras',
    'Gestão',
    'Desligado',
    'Expedição'
);


ALTER TYPE public.tipo_operador_enum OWNER TO postgres;

--
-- TOC entry 593 (class 1255 OID 90782)
-- Name: atualizar_caches_produtos(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atualizar_caches_produtos() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM public.atualizar_produtos_cache();
  PERFORM public.atualizar_ean14_cache();
END;
$$;


ALTER FUNCTION public.atualizar_caches_produtos() OWNER TO postgres;

--
-- TOC entry 702 (class 1255 OID 4333186)
-- Name: atualizar_data_reservas(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atualizar_data_reservas() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.atualizar_data_reservas() OWNER TO postgres;

--
-- TOC entry 673 (class 1255 OID 90697)
-- Name: atualizar_ean14_cache(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atualizar_ean14_cache() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.produtos_ean14;
END;
$$;


ALTER FUNCTION public.atualizar_ean14_cache() OWNER TO postgres;

--
-- TOC entry 615 (class 1255 OID 3943764)
-- Name: atualizar_entradas_aworks(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atualizar_entradas_aworks() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW vw_entradas_producao_aworks;
END;
$$;


ALTER FUNCTION public.atualizar_entradas_aworks() OWNER TO postgres;

--
-- TOC entry 583 (class 1255 OID 15495466)
-- Name: atualizar_grupo_subgrupo_produtos(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atualizar_grupo_subgrupo_produtos() RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_atualizados INTEGER;
    v_mensagem TEXT;
BEGIN
    WITH atualizados AS (
        UPDATE public.produtos p
        SET 
            subgrupoprodutoid = aw_prod.subgrupoprodutoid,
            grupoprodutoid = sg.grupoprodutoid
        FROM dblink(
            'dbname=AWORKSDB host=192.168.10.252 user=postgres password=aw2000',
            '
            SELECT 
                p.produtoid,
                p.subgrupoprodutoid
            FROM produto p
            WHERE p.empresaid = 1
              AND p.status_produto = ''ATIVO''
            '
        ) AS aw_prod(
            produtoid NUMERIC(15,2),
            subgrupoprodutoid NUMERIC(8,0)
        )
        LEFT JOIN public.subgrupoproduto sg ON aw_prod.subgrupoprodutoid = sg.subgrupoprodutoid
        WHERE p.id_cache = aw_prod.produtoid
          AND p.id_cache IS NOT NULL
        RETURNING p.id
    )
    SELECT COUNT(*) INTO v_atualizados FROM atualizados;
    
    v_mensagem := format('Atualização concluída: %s produtos atualizados.', v_atualizados);
    
    RETURN v_mensagem;
END;
$$;


ALTER FUNCTION public.atualizar_grupo_subgrupo_produtos() OWNER TO postgres;

--
-- TOC entry 645 (class 1255 OID 15494171)
-- Name: atualizar_grupos_subgrupos(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atualizar_grupos_subgrupos() RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_grupos_inseridos INTEGER;
    v_subgrupos_inseridos INTEGER;
    v_mensagem TEXT;
BEGIN
    -- Atualizar grupos
    INSERT INTO public.grupoproduto (
        grupoprodutoid,
        nome_grupoproduto,
        filialid,
        empresaid,
        vl_meta_mensal_grupoproduto
    )
    SELECT 
        gp.grupoprodutoid,
        gp.nome_grupoproduto,
        gp.filialid,
        gp.empresaid,
        gp.vl_meta_mensal_grupoproduto
    FROM dblink(
        'dbname=AWORKSDB host=192.168.10.252 user=postgres password=aw2000',
        '
        SELECT 
            grupoprodutoid,
            nome_grupoproduto,
            filialid,
            empresaid,
            vl_meta_mensal_grupoproduto
        FROM grupoproduto
        WHERE empresaid = 1
          AND filialid = 1
        '
    ) AS gp(
        grupoprodutoid NUMERIC(8,0),
        nome_grupoproduto VARCHAR(50),
        filialid NUMERIC(8,0),
        empresaid NUMERIC(8,0),
        vl_meta_mensal_grupoproduto NUMERIC(23,4)
    )
    ON CONFLICT (grupoprodutoid) DO UPDATE SET
        nome_grupoproduto = EXCLUDED.nome_grupoproduto,
        vl_meta_mensal_grupoproduto = EXCLUDED.vl_meta_mensal_grupoproduto;
    
    GET DIAGNOSTICS v_grupos_inseridos = ROW_COUNT;
    
    -- Atualizar subgrupos
    INSERT INTO public.subgrupoproduto (
        subgrupoprodutoid,
        nome_subgrupoproduto,
        bo_ipicusto_subgrupoproduto,
        grupoprodutoid,
        ifpvid,
        vl_custo_hora_produto,
        vl_meta_mensal_subgrupoproduto,
        bo_verifica_mp_lote
    )
    SELECT 
        sg.subgrupoprodutoid,
        sg.nome_subgrupoproduto,
        sg.bo_ipicusto_subgrupoproduto,
        sg.grupoprodutoid,
        sg.ifpvid,
        sg.vl_custo_hora_produto,
        sg.vl_meta_mensal_subgrupoproduto,
        sg.bo_verifica_mp_lote
    FROM dblink(
        'dbname=AWORKSDB host=192.168.10.252 user=postgres password=aw2000',
        '
        SELECT 
            sg.subgrupoprodutoid,
            sg.nome_subgrupoproduto,
            sg.bo_ipicusto_subgrupoproduto,
            sg.grupoprodutoid,
            sg.ifpvid,
            sg.vl_custo_hora_produto,
            sg.vl_meta_mensal_subgrupoproduto,
            sg.bo_verifica_mp_lote
        FROM subgrupoproduto sg
        INNER JOIN grupoproduto gp ON sg.grupoprodutoid = gp.grupoprodutoid
        WHERE gp.empresaid = 1
          AND gp.filialid = 1
        '
    ) AS sg(
        subgrupoprodutoid NUMERIC(8,0),
        nome_subgrupoproduto VARCHAR(50),
        bo_ipicusto_subgrupoproduto VARCHAR(3),
        grupoprodutoid NUMERIC(8,0),
        ifpvid NUMERIC(8,0),
        vl_custo_hora_produto NUMERIC(15,4),
        vl_meta_mensal_subgrupoproduto NUMERIC(23,4),
        bo_verifica_mp_lote VARCHAR(3)
    )
    ON CONFLICT (subgrupoprodutoid) DO UPDATE SET
        nome_subgrupoproduto = EXCLUDED.nome_subgrupoproduto,
        bo_ipicusto_subgrupoproduto = EXCLUDED.bo_ipicusto_subgrupoproduto,
        grupoprodutoid = EXCLUDED.grupoprodutoid,
        ifpvid = EXCLUDED.ifpvid,
        vl_custo_hora_produto = EXCLUDED.vl_custo_hora_produto,
        vl_meta_mensal_subgrupoproduto = EXCLUDED.vl_meta_mensal_subgrupoproduto,
        bo_verifica_mp_lote = EXCLUDED.bo_verifica_mp_lote;
    
    GET DIAGNOSTICS v_subgrupos_inseridos = ROW_COUNT;
    
    v_mensagem := format('Atualização concluída: %s grupos e %s subgrupos processados.', 
                         v_grupos_inseridos, v_subgrupos_inseridos);
    
    RETURN v_mensagem;
END;
$$;


ALTER FUNCTION public.atualizar_grupos_subgrupos() OWNER TO postgres;

--
-- TOC entry 660 (class 1255 OID 9525395)
-- Name: atualizar_pedido_itens_aworks_simples_mv(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atualizar_pedido_itens_aworks_simples_mv() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.pedido_itens_aworks_simples_mv;
END;
$$;


ALTER FUNCTION public.atualizar_pedido_itens_aworks_simples_mv() OWNER TO postgres;

--
-- TOC entry 661 (class 1255 OID 206139)
-- Name: atualizar_pedidos_despacho_mv(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atualizar_pedidos_despacho_mv() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY pedidos_prontos_despacho_mv;
END;
$$;


ALTER FUNCTION public.atualizar_pedidos_despacho_mv() OWNER TO postgres;

--
-- TOC entry 579 (class 1255 OID 74595)
-- Name: atualizar_produtos_cache(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atualizar_produtos_cache() RETURNS void
    LANGUAGE sql
    AS $$
  REFRESH MATERIALIZED VIEW public.produtos_cache;
$$;


ALTER FUNCTION public.atualizar_produtos_cache() OWNER TO postgres;

--
-- TOC entry 582 (class 1255 OID 16713663)
-- Name: atualizar_vw_analise_separacao_mv(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atualizar_vw_analise_separacao_mv() RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_inicio TIMESTAMP;
  v_fim TIMESTAMP;
  v_duracao TEXT;
  v_resultado TEXT;
BEGIN
  v_inicio := clock_timestamp();
  
  -- Refresh da view materializada
  REFRESH MATERIALIZED VIEW CONCURRENTLY vw_analise_separacao_mv;
  
  v_fim := clock_timestamp();
  v_duracao := EXTRACT(EPOCH FROM (v_fim - v_inicio))::TEXT || ' segundos';
  
  v_resultado := 'View atualizada com sucesso em ' || v_duracao;
  
  -- Registrar no log (opcional)
  INSERT INTO logs_sistema (tipo, mensagem, data_criacao)
  VALUES ('INFO', 'vw_analise_separacao_mv atualizada em ' || v_duracao, NOW());
  
  RETURN v_resultado;
EXCEPTION WHEN OTHERS THEN
  v_resultado := 'Erro ao atualizar view: ' || SQLERRM;
  
  INSERT INTO logs_sistema (tipo, mensagem, data_criacao)
  VALUES ('ERRO', 'Erro ao atualizar view: ' || SQLERRM, NOW());
  
  RETURN v_resultado;
END;
$$;


ALTER FUNCTION public.atualizar_vw_analise_separacao_mv() OWNER TO postgres;

--
-- TOC entry 618 (class 1255 OID 16722228)
-- Name: atualizar_vw_divergencias_mv(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atualizar_vw_divergencias_mv() RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_inicio TIMESTAMP;
    v_fim TIMESTAMP;
    v_duracao TEXT;
    v_resultado TEXT;
BEGIN
    v_inicio := clock_timestamp();
    
    -- Refresh da view materializada
    REFRESH MATERIALIZED VIEW CONCURRENTLY vw_analise_divergencias_mv;
    
    v_fim := clock_timestamp();
    v_duracao := EXTRACT(EPOCH FROM (v_fim - v_inicio))::TEXT || ' segundos';
    
    v_resultado := 'View atualizada com sucesso em ' || v_duracao;
    
    -- Tentar registrar no log (se a tabela existir)
    BEGIN
        INSERT INTO logs_sistema (tipo, mensagem, data_criacao)
        VALUES ('INFO', 'vw_analise_divergencias_mv atualizada em ' || v_duracao, NOW());
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Não foi possível registrar log (tabela logs_sistema não encontrada)';
    END;
    
    RETURN v_resultado;
EXCEPTION WHEN OTHERS THEN
    v_resultado := 'Erro ao atualizar view: ' || SQLERRM;
    
    BEGIN
        INSERT INTO logs_sistema (tipo, mensagem, data_criacao)
        VALUES ('ERRO', 'Erro ao atualizar view: ' || SQLERRM, NOW());
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Erro ao atualizar view: %', SQLERRM;
    END;
    
    RETURN v_resultado;
END;
$$;


ALTER FUNCTION public.atualizar_vw_divergencias_mv() OWNER TO postgres;

--
-- TOC entry 704 (class 1255 OID 16639932)
-- Name: atualizar_vw_separacao_pedidos(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.atualizar_vw_separacao_pedidos() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY vw_separacao_pedidos_rapida;
END;
$$;


ALTER FUNCTION public.atualizar_vw_separacao_pedidos() OWNER TO postgres;

--
-- TOC entry 584 (class 1255 OID 6208169)
-- Name: bloquear_item_separacao(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.bloquear_item_separacao(p_pedidovendaitemid integer, p_id_operador integer) RETURNS TABLE(sucesso boolean, mensagem character varying, bloqueado_por integer, nome_operador character varying)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_bloqueado_por INTEGER;
    v_nome_operador VARCHAR(200);
BEGIN
    -- Verificar se item já está bloqueado por outro operador
    SELECT si.bloqueado_por INTO v_bloqueado_por
    FROM public.separacao_itens si
    WHERE si.pedidovendaitemid = p_pedidovendaitemid
    FOR UPDATE;

    IF v_bloqueado_por IS NOT NULL AND v_bloqueado_por != p_id_operador THEN
        -- Já está bloqueado por outro operador
        SELECT o.nome INTO v_nome_operador
        FROM public.operadores o
        WHERE o.id = v_bloqueado_por;
        
        RETURN QUERY SELECT 
            FALSE,
            ('Item já está bloqueado por ' || COALESCE(v_nome_operador, 'outro operador'))::VARCHAR(500),
            v_bloqueado_por,
            v_nome_operador;
        RETURN;
    END IF;

    -- Bloquear o item para este operador
    UPDATE public.separacao_itens
    SET bloqueado_por = p_id_operador,
        data_bloqueio = CURRENT_TIMESTAMP,
        quantidade_separada_inicial = COALESCE(quantidade_separada, 0)
    WHERE pedidovendaitemid = p_pedidovendaitemid;

    -- Buscar nome do operador
    SELECT o.nome INTO v_nome_operador
    FROM public.operadores o
    WHERE o.id = p_id_operador;

    RETURN QUERY SELECT 
        TRUE,
        'Item bloqueado com sucesso'::VARCHAR(500),
        p_id_operador,
        v_nome_operador;
END;
$$;


ALTER FUNCTION public.bloquear_item_separacao(p_pedidovendaitemid integer, p_id_operador integer) OWNER TO postgres;

--
-- TOC entry 6418 (class 0 OID 0)
-- Dependencies: 584
-- Name: FUNCTION bloquear_item_separacao(p_pedidovendaitemid integer, p_id_operador integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.bloquear_item_separacao(p_pedidovendaitemid integer, p_id_operador integer) IS 'Bloqueia um item para um operador específico, impedindo que outro operador trabalhe nele';


--
-- TOC entry 647 (class 1255 OID 16898763)
-- Name: buscar_divergencias_pendentes(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.buscar_divergencias_pendentes(p_limite integer DEFAULT 1000) RETURNS TABLE(id integer, pedidovendaid integer, nr_nota_fiscal character varying, cliente_nome character varying, pedidovendaitemid integer, produto_descricao character varying, produto_referencia character varying, quantidade_solicitada numeric, quantidade_separada numeric, quantidade_despachada numeric, divergencia numeric, data_detecao timestamp without time zone, status character varying, tempo_pendente_minutos numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        d.id::INTEGER,
        d.pedidovendaid,
        d.nr_nota_fiscal,
        d.cliente_nome,
        d.pedidovendaitemid,
        d.produto_descricao,
        d.produto_referencia,
        d.quantidade_solicitada,
        d.quantidade_separada,
        d.quantidade_despachada,
        d.divergencia,
        d.data_detecao,
        d.status,
        ROUND(EXTRACT(EPOCH FROM (NOW() - d.data_detecao)) / 60, 2)::NUMERIC AS tempo_pendente_minutos
    FROM divergencias_estoque d
    WHERE d.status = 'PENDENTE'
        AND DATE(d.data_detecao) >= (CURRENT_DATE - 1)  -- 🔥 ONTEM E HOJE
    ORDER BY d.divergencia DESC, d.data_detecao DESC
    LIMIT p_limite;
END;
$$;


ALTER FUNCTION public.buscar_divergencias_pendentes(p_limite integer) OWNER TO postgres;

--
-- TOC entry 659 (class 1255 OID 78905)
-- Name: cache_to_original_id(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.cache_to_original_id(cache_id integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    original_id INTEGER;
BEGIN
    SELECT id_original INTO original_id 
    FROM produto_id_mapping 
    WHERE id_cache = cache_id AND ativo = true
    LIMIT 1;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mapeamento não encontrado para ID cache %', cache_id;
    END IF;
    
    RETURN original_id;
END;
$$;


ALTER FUNCTION public.cache_to_original_id(cache_id integer) OWNER TO postgres;

--
-- TOC entry 552 (class 1255 OID 105059)
-- Name: calcular_oee_por_produto(integer, integer, timestamp without time zone, timestamp without time zone); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.calcular_oee_por_produto(p_id_apontamento integer DEFAULT NULL::integer, p_id_maquina integer DEFAULT NULL::integer, p_data_inicio timestamp without time zone DEFAULT NULL::timestamp without time zone, p_data_fim timestamp without time zone DEFAULT NULL::timestamp without time zone) RETURNS TABLE(id_maquina integer, id_produto integer, id_apontamento integer, tipo_maquina character varying, produto_descricao character varying, disponibilidade numeric, performance numeric, qualidade numeric, oee numeric, tempo_total_segundos integer, tempo_paradas_segundos integer, tempo_producao_segundos integer, pecas_produzidas integer, pecas_boas integer, pecas_defeituosas integer, velocidade_ideal_pecas_hora integer, velocidade_real_pecas_hora integer, tempo_padrao_segundos numeric, meta_horaria integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_tempo_total INTERVAL;
    v_tempo_paradas INTERVAL;
    v_tempo_producao INTERVAL;
    v_pecas_produzidas INTEGER;
    v_pecas_boas INTEGER;
    v_pecas_defeituosas INTEGER;
    v_tempo_padrao DECIMAL(10,2);
    v_meta_horaria INTEGER;
    v_velocidade_real INTEGER;
    v_velocidade_ideal INTEGER;
    v_tipo_maquina VARCHAR(20);
    v_id_produto INTEGER;
    v_produto_descricao VARCHAR(100);
BEGIN
    -- Determinar parâmetros baseados no que foi passado
    IF p_id_apontamento IS NOT NULL THEN
        -- Cálculo para um apontamento específico
        SELECT 
            ap.id_maquina, ap.id_produto, ap.id,
            maq.tipo_maquina, prod.ds_produto,
            ap.data_inicio, COALESCE(ap.data_fim, NOW()),
            ap.quantidade_pecas, COALESCE(ap.pecas_boas, ap.quantidade_pecas)
        INTO 
            id_maquina, v_id_produto, id_apontamento,
            v_tipo_maquina, v_produto_descricao,
            p_data_inicio, p_data_fim,
            v_pecas_produzidas, v_pecas_boas
        FROM apontamento_producao ap
        INNER JOIN maquinas maq ON ap.id_maquina = maq.id
        LEFT JOIN produtos prod ON ap.id_produto = prod.id
        WHERE ap.id = p_id_apontamento;
        
    ELSIF p_id_maquina IS NOT NULL AND p_data_inicio IS NOT NULL AND p_data_fim IS NOT NULL THEN
        -- Cálculo para uma máquina em um período
        id_maquina := p_id_maquina;
        
        SELECT tipo_maquina INTO v_tipo_maquina
        FROM maquinas WHERE id = p_id_maquina;
        
        -- Usar o produto mais recente do período
        SELECT ap.id_produto, prod.ds_produto
        INTO v_id_produto, v_produto_descricao
        FROM apontamento_producao ap
        LEFT JOIN produtos prod ON ap.id_produto = prod.id
        WHERE ap.id_maquina = p_id_maquina
        AND ap.data_inicio BETWEEN p_data_inicio AND p_data_fim
        ORDER BY ap.data_inicio DESC
        LIMIT 1;
        
        -- Calcular totais do período
        SELECT 
            COALESCE(SUM(ap.quantidade_pecas), 0),
            COALESCE(SUM(ap.pecas_boas), 0)
        INTO v_pecas_produzidas, v_pecas_boas
        FROM apontamento_producao ap
        WHERE ap.id_maquina = p_id_maquina
        AND ap.data_inicio BETWEEN p_data_inicio AND p_data_fim;
    ELSE
        RETURN; -- Parâmetros insuficientes
    END IF;
    
    v_pecas_defeituosas := v_pecas_produzidas - v_pecas_boas;
    
    -- Calcular tempos
    IF p_id_apontamento IS NOT NULL THEN
        -- Para apontamento único
        v_tempo_total := COALESCE(p_data_fim - p_data_inicio, INTERVAL '0 seconds');
        
        SELECT COALESCE(SUM(pp.data_fim - pp.data_inicio), INTERVAL '0 seconds')
        INTO v_tempo_paradas
        FROM paradas_producao pp
        WHERE pp.id_apontamento = p_id_apontamento;
        
    ELSE
        -- Para período
        v_tempo_total := p_data_fim - p_data_inicio;
        
        SELECT COALESCE(SUM(pp.data_fim - pp.data_inicio), INTERVAL '0 seconds')
        INTO v_tempo_paradas
        FROM paradas_producao pp
        INNER JOIN apontamento_producao ap ON pp.id_apontamento = ap.id
        WHERE ap.id_maquina = p_id_maquina
        AND ap.data_inicio BETWEEN p_data_inicio AND p_data_fim;
    END IF;
    
    v_tempo_producao := v_tempo_total - v_tempo_paradas;
    
    -- Obter parâmetros do produto
    v_tempo_padrao := obter_tempo_padrao_produto(v_id_produto, v_tipo_maquina);
    v_meta_horaria := obter_meta_horaria_produto(v_id_produto, v_tipo_maquina);
    
    -- Calcular velocidades
    IF EXTRACT(EPOCH FROM v_tempo_producao) > 0 THEN
        v_velocidade_real := (v_pecas_produzidas * 3600) / EXTRACT(EPOCH FROM v_tempo_producao);
    ELSE
        v_velocidade_real := 0;
    END IF;
    
    v_velocidade_ideal := COALESCE(v_meta_horaria, 0);
    
    -- Calcular indicadores OEE
    -- Disponibilidade = Tempo Produção / Tempo Total
    IF EXTRACT(EPOCH FROM v_tempo_total) > 0 THEN
        disponibilidade := (EXTRACT(EPOCH FROM v_tempo_producao) / EXTRACT(EPOCH FROM v_tempo_total)) * 100;
    ELSE
        disponibilidade := 0;
    END IF;
    
    -- Performance = Velocidade Real / Velocidade Ideal
    IF v_velocidade_ideal > 0 THEN
        performance := (v_velocidade_real::DECIMAL / v_velocidade_ideal) * 100;
    ELSE
        performance := 0;
    END IF;
    
    -- Qualidade = Peças Boas / Peças Produzidas
    IF v_pecas_produzidas > 0 THEN
        qualidade := (v_pecas_boas::DECIMAL / v_pecas_produzidas) * 100;
    ELSE
        qualidade := 0;
    END IF;
    
    -- OEE = Disponibilidade × Performance × Qualidade
    oee := (disponibilidade / 100) * (performance / 100) * (qualidade / 100) * 100;
    
    -- Retornar valores
    tempo_total_segundos := EXTRACT(EPOCH FROM v_tempo_total);
    tempo_paradas_segundos := EXTRACT(EPOCH FROM v_tempo_paradas);
    tempo_producao_segundos := EXTRACT(EPOCH FROM v_tempo_producao);
    pecas_produzidas := v_pecas_produzidas;
    pecas_boas := v_pecas_boas;
    pecas_defeituosas := v_pecas_defeituosas;
    velocidade_ideal_pecas_hora := v_velocidade_ideal;
    velocidade_real_pecas_hora := v_velocidade_real;
    tipo_maquina := v_tipo_maquina;
    id_produto := v_id_produto;
    produto_descricao := v_produto_descricao;
    
    RETURN NEXT;
    
END;
$$;


ALTER FUNCTION public.calcular_oee_por_produto(p_id_apontamento integer, p_id_maquina integer, p_data_inicio timestamp without time zone, p_data_fim timestamp without time zone) OWNER TO postgres;

--
-- TOC entry 669 (class 1255 OID 4333193)
-- Name: calcular_prioridade_pedido(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.calcular_prioridade_pedido(p_pedidovendaid integer) RETURNS character varying
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_prioridade VARCHAR(20);
    v_data_despacho DATE;
    v_data_hoje DATE;
    v_dias_restantes INTEGER;
BEGIN
    -- Buscar data de prioridade da separacao_pedidos
    SELECT 
        sp.data_prioridade_separacao::DATE
    INTO v_data_despacho
    FROM separacao_pedidos sp
    WHERE sp.pedidovendaid = p_pedidovendaid
    LIMIT 1;
    
    -- Se não encontrou data, retorna ROXO (sem data)
    IF v_data_despacho IS NULL THEN
        RETURN 'ROXO';
    END IF;
    
    v_data_hoje := CURRENT_DATE;
    v_dias_restantes := (v_data_despacho - v_data_hoje);
    
    -- Classificar por dias restantes
    IF v_dias_restantes <= 0 THEN
        v_prioridade := 'VERMELHO'; -- Vencido ou entrega hoje
    ELSIF v_dias_restantes = 1 THEN
        v_prioridade := 'LARANJA';  -- Amanhã
    ELSIF v_dias_restantes <= 3 THEN
        v_prioridade := 'AMARELO';  -- Até 3 dias
    ELSE
        v_prioridade := 'VERDE';    -- Mais de 3 dias
    END IF;
    
    RETURN v_prioridade;
END;
$$;


ALTER FUNCTION public.calcular_prioridade_pedido(p_pedidovendaid integer) OWNER TO postgres;

--
-- TOC entry 6421 (class 0 OID 0)
-- Dependencies: 669
-- Name: FUNCTION calcular_prioridade_pedido(p_pedidovendaid integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.calcular_prioridade_pedido(p_pedidovendaid integer) IS 'Calcula a prioridade de um pedido baseado na data de despacho/prioridade';


--
-- TOC entry 644 (class 1255 OID 24576)
-- Name: calcular_tempo_de_parada(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.calcular_tempo_de_parada() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE qualidade_producao
    SET tempo_de_parada_total = 
        (COALESCE(fim_primeira_parada::time, '00:00'::time) - COALESCE(inicio_primeira_parada::time, '00:00'::time)) +
        (COALESCE(fim_segunda_parada::time, '00:00'::time) - COALESCE(inicio_segunda_parada::time, '00:00'::time)) +
        (COALESCE(fim_terceira_parada::time, '00:00'::time) - COALESCE(inicio_terceira_parada::time, '00:00'::time)) +
        (COALESCE(fim_quarta_parada::time, '00:00'::time) - COALESCE(inicio_quarta_parada::time, '00:00'::time)) +
        (COALESCE(fim_quinta_parada::time, '00:00'::time) - COALESCE(inicio_quinta_parada::time, '00:00'::time));
END;
$$;


ALTER FUNCTION public.calcular_tempo_de_parada() OWNER TO postgres;

--
-- TOC entry 680 (class 1255 OID 74306)
-- Name: calcular_tempo_troca_molde(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.calcular_tempo_troca_molde() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Se for uma troca de molde, definir tempo estimado padrão de 2 horas
    IF NEW.tipo = 'troca_molde' AND NEW.tempo_estimado IS NULL THEN
        NEW.tempo_estimado := 120; -- 2 horas
        NEW.data_fim := NEW.data_inicio + (NEW.tempo_estimado * interval '1 minute');
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.calcular_tempo_troca_molde() OWNER TO postgres;

--
-- TOC entry 605 (class 1255 OID 177389)
-- Name: classificar_parada(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.classificar_parada(motivo_parada text) RETURNS text
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN CASE 
        WHEN motivo_parada IN ('Horário de refeição', 'Troca de Turno', 'Manutenção Preventiva', 'Setup Programado') 
        THEN 'PROGRAMADA'
        ELSE 'NAO_PROGRAMADA'
    END;
END;
$$;


ALTER FUNCTION public.classificar_parada(motivo_parada text) OWNER TO postgres;

--
-- TOC entry 664 (class 1255 OID 125358)
-- Name: converter_endereco_real(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.converter_endereco_real(endereco_antigo integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- RUA 1: Endereços 1-100
    IF endereco_antigo BETWEEN 1 AND 100 THEN
        CASE endereco_antigo
            -- Módulos que vão para Rua 4 (R1-M1 e R1-M7)
            WHEN 1 THEN RETURN 220;  -- R1-M1 → R4-M21
            WHEN 2 THEN RETURN 221;  -- R1-M1 → R4-M21
            
            -- Módulos que ficam na Rua 1 (2-6)
            WHEN 3 THEN RETURN 1;    -- R1-M2 → R1-M1
            WHEN 4 THEN RETURN 2;    -- R1-M2 → R1-M1
            WHEN 5 THEN RETURN 7;    -- R1-M3 → R1-M2  
            WHEN 6 THEN RETURN 8;    -- R1-M3 → R1-M2
            WHEN 9 THEN RETURN 13;   -- R1-M4 → R1-M3
            WHEN 10 THEN RETURN 14;  -- R1-M4 → R1-M3
            WHEN 11 THEN RETURN 19;  -- R1-M5 → R1-M4
            WHEN 12 THEN RETURN 20;  -- R1-M5 → R1-M4
            
            -- Elimina o resto da Rua 1
            ELSE RETURN -1;
        END CASE;
    
    -- RUA 2: Endereços 400-500
    ELSIF endereco_antigo BETWEEN 400 AND 500 THEN
        CASE endereco_antigo
            -- Módulos que vão para Rua 5 (R2-M1 e R2-M6)
            WHEN 409 THEN RETURN 352;  -- R2-M1 → R5-M21
            WHEN 410 THEN RETURN 353;  -- R2-M1 → R5-M21
            
            -- Módulos que ficam na Rua 2 (2-4)
            WHEN 411 THEN RETURN 31;   -- R2-M2 → R2-M1
            WHEN 412 THEN RETURN 32;   -- R2-M2 → R2-M1
            WHEN 413 THEN RETURN 37;   -- R2-M3 → R2-M2
            WHEN 414 THEN RETURN 38;   -- R2-M3 → R2-M2
            WHEN 415 THEN RETURN 43;   -- R2-M4 → R2-M3
            WHEN 416 THEN RETURN 44;   -- R2-M4 → R2-M3
            
            -- Elimina o resto da Rua 2
            ELSE RETURN -1;
        END CASE;
    
    -- RUA 3: Mantém os mesmos endereços (500-600)
    ELSIF endereco_antigo BETWEEN 500 AND 600 THEN
        RETURN endereco_antigo;
    
    -- OUTRAS RUAS: Mantém original
    ELSE
        RETURN endereco_antigo;
    END IF;
END;
$$;


ALTER FUNCTION public.converter_endereco_real(endereco_antigo integer) OWNER TO postgres;

--
-- TOC entry 576 (class 1255 OID 125354)
-- Name: converter_endereco_simples(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.converter_endereco_simples(endereco_antigo integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    rua INTEGER;
    modulo INTEGER;
    nivel INTEGER;
    posicao INTEGER;
BEGIN
    -- Extrair componentes
    rua := (endereco_antigo / 10000);
    modulo := (endereco_antigo / 100) % 100;
    nivel := (endereco_antigo / 10) % 10;
    posicao := endereco_antigo % 10;
    
    -- Debug (opcional)
    RAISE NOTICE 'Endereço: %, Rua: %, Módulo: %, Nível: %, Posição: %', 
                 endereco_antigo, rua, modulo, nivel, posicao;
    
    -- RUA 1
    IF rua = 1 THEN
        IF modulo = 1 THEN
            -- R1-M1 → R4-M21 (220-225)
            RETURN 220 + ((nivel - 1) * 2) + (posicao - 1);
        ELSIF modulo = 7 THEN
            -- R1-M7 → R4-M22 (226-231)
            RETURN 226 + ((nivel - 1) * 2) + (posicao - 1);
        ELSIF modulo BETWEEN 2 AND 5 THEN
            -- R1-M2,3,4,5 → R1-M1,2,3,4
            RETURN ((modulo - 2) * 6) + ((nivel - 1) * 2) + posicao;
        ELSE
            RETURN -1; -- Eliminado
        END IF;
    
    -- RUA 2  
    ELSIF rua = 2 THEN
        IF modulo = 1 THEN
            -- R2-M1 → R5-M21 (352-357)
            RETURN 352 + ((nivel - 1) * 2) + (posicao - 1);
        ELSIF modulo = 6 THEN
            -- R2-M6 → R5-M22 (358-363)
            RETURN 358 + ((nivel - 1) * 2) + (posicao - 1);
        ELSIF modulo BETWEEN 2 AND 4 THEN
            -- R2-M2,3,4 → R2-M1,2,3
            RETURN 31 + ((modulo - 2) * 6) + ((nivel - 1) * 2) + posicao;
        ELSE
            RETURN -1; -- Eliminado
        END IF;
    
    -- RUA 3 - mantém
    ELSIF rua = 3 THEN
        RETURN endereco_antigo;
    
    -- OUTRAS - mantém
    ELSE
        RETURN endereco_antigo;
    END IF;
    
END;
$$;


ALTER FUNCTION public.converter_endereco_simples(endereco_antigo integer) OWNER TO postgres;

--
-- TOC entry 591 (class 1255 OID 6208170)
-- Name: desbloquear_item_separacao(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.desbloquear_item_separacao(p_pedidovendaitemid integer, p_id_operador integer) RETURNS TABLE(sucesso boolean, mensagem character varying)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_item RECORD;
    v_pedidovendaid INTEGER;
BEGIN
    SELECT
        si.id,
        si.id_separacao_pedido,
        si.bloqueado_por,
        si.data_bloqueio,
        si.quantidade_solicitada,
        si.quantidade_separada,
        si.quantidade_separada_inicial
    INTO v_item
    FROM public.separacao_itens si
    WHERE si.pedidovendaitemid = p_pedidovendaitemid
      AND si.bloqueado_por IS NOT NULL
    ORDER BY si.data_bloqueio DESC NULLS LAST,
             si.updated_at DESC NULLS LAST,
             si.id DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND OR v_item.bloqueado_por IS NULL THEN
        RETURN QUERY SELECT
            FALSE,
            'Item não está bloqueado'::VARCHAR(500);
        RETURN;
    END IF;

    IF v_item.bloqueado_por != p_id_operador THEN
        RETURN QUERY SELECT
            FALSE,
            'Apenas o operador que bloqueou pode desbloquear'::VARCHAR(500);
        RETURN;
    END IF;

    SELECT sp.pedidovendaid
      INTO v_pedidovendaid
    FROM public.separacao_pedidos sp
    WHERE sp.id = v_item.id_separacao_pedido;

    INSERT INTO public.separacao_itens_bloqueio (
        pedidovendaitemid,
        pedidovendaid,
        bloqueado_por,
        desbloqueado_por,
        data_bloqueio,
        data_desbloqueio,
        quantidade_solicitada,
        quantidade_separada_quando_bloqueado,
        quantidade_separada_quando_desbloqueado,
        motivo_desbloqueio
    ) VALUES (
        p_pedidovendaitemid,
        v_pedidovendaid,
        v_item.bloqueado_por,
        p_id_operador,
        v_item.data_bloqueio,
        CURRENT_TIMESTAMP,
        v_item.quantidade_solicitada,
        v_item.quantidade_separada_inicial,
        v_item.quantidade_separada,
        'FINALIZADO_PARCIAL'
    );

    UPDATE public.separacao_itens
    SET bloqueado_por = NULL,
        data_bloqueio = NULL,
        updated_at = NOW()
    WHERE id = v_item.id;

    RETURN QUERY SELECT
        TRUE,
        'Item desbloqueado com sucesso'::VARCHAR(500);
END;
$$;


ALTER FUNCTION public.desbloquear_item_separacao(p_pedidovendaitemid integer, p_id_operador integer) OWNER TO postgres;

--
-- TOC entry 6423 (class 0 OID 0)
-- Dependencies: 591
-- Name: FUNCTION desbloquear_item_separacao(p_pedidovendaitemid integer, p_id_operador integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.desbloquear_item_separacao(p_pedidovendaitemid integer, p_id_operador integer) IS 'Desbloqueia um item quando o operador termina (parcialmente ou totalmente)';


--
-- TOC entry 694 (class 1255 OID 16900949)
-- Name: detectar_divergencias(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.detectar_divergencias() RETURNS TABLE(id integer, pedidovendaid integer, nr_nota_fiscal character varying, cliente_nome character varying, pedidovendaitemid integer, produto_descricao character varying, produto_referencia character varying, quantidade_solicitada numeric, quantidade_separada numeric, quantidade_despachada numeric, divergencia numeric, data_detecao timestamp without time zone, status character varying, mensagem text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_div RECORD;
    v_inserido_id INTEGER;
    v_count INTEGER := 0;
BEGIN
    -- Buscar divergências da view
    FOR v_div IN
        SELECT 
            vw.*
        FROM vw_divergencias_pendentes vw
        WHERE NOT EXISTS (
            SELECT 1 FROM divergencias_estoque d 
            WHERE d.pedidovendaitemid = vw.pedidovendaitemid 
                AND d.status = 'PENDENTE'
        )
        ORDER BY vw.divergencia DESC
    LOOP
        -- Inserir divergência
        INSERT INTO divergencias_estoque (
            pedidovendaid,
            nr_nota_fiscal,
            cliente_nome,
            pedidovendaitemid,
            produto_descricao,
            produto_referencia,
            quantidade_solicitada,
            quantidade_separada,
            quantidade_despachada,
            divergencia,
            data_detecao,
            status
        ) VALUES (
            v_div.pedidovendaid,
            v_div.nr_nota_fiscal,
            v_div.cliente_nome,
            v_div.pedidovendaitemid,
            v_div.produto_descricao,
            v_div.produto_referencia,
            v_div.quantidade_solicitada,
            v_div.quantidade_separada,
            v_div.quantidade_despachada,
            v_div.divergencia,
            v_div.data_detecao,
            'PENDENTE'
        )
        RETURNING divergencias_estoque.id INTO v_inserido_id;
        
        v_count := v_count + 1;
        
        RETURN QUERY
        SELECT 
            d.id::INTEGER,
            d.pedidovendaid,
            d.nr_nota_fiscal,
            d.cliente_nome,
            d.pedidovendaitemid,
            d.produto_descricao,
            d.produto_referencia,
            d.quantidade_solicitada,
            d.quantidade_separada,
            d.quantidade_despachada,
            d.divergencia,
            d.data_detecao,
            d.status,
            '⚠️ Despachado (' || d.quantidade_despachada || ') > Separado (' || d.quantidade_separada || ')' AS mensagem
        FROM divergencias_estoque d
        WHERE d.id = v_inserido_id;
    END LOOP;
    
    IF v_count = 0 THEN
        RETURN QUERY
        SELECT 
            0::INTEGER,
            0::INTEGER,
            ''::VARCHAR,
            ''::VARCHAR,
            0::INTEGER,
            ''::VARCHAR,
            ''::VARCHAR,
            0::NUMERIC,
            0::NUMERIC,
            0::NUMERIC,
            0::NUMERIC,
            NOW()::TIMESTAMP,
            'NENHUMA'::VARCHAR,
            'Nenhuma divergência encontrada'::TEXT;
    END IF;
    
    RETURN;
END;
$$;


ALTER FUNCTION public.detectar_divergencias() OWNER TO postgres;

--
-- TOC entry 654 (class 1255 OID 16358001)
-- Name: diagnosticar_colunas_estrutura_aworks(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.diagnosticar_colunas_estrutura_aworks() RETURNS TABLE(ordinal_position integer, column_name text, data_type text)
    LANGUAGE plpgsql
    AS $_$
DECLARE
  conn text := current_setting('app.aworks_dblink_conn', true);
BEGIN
  IF conn IS NULL OR btrim(conn) = '' THEN
    RAISE EXCEPTION 'Parametro app.aworks_dblink_conn nao configurado';
  END IF;

  RETURN QUERY
  SELECT t.ordinal_position, t.column_name, t.data_type
  FROM dblink(
    conn,
    $aw$
    SELECT ordinal_position, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'estrutura'
    ORDER BY ordinal_position
    $aw$
  ) AS t(ordinal_position integer, column_name text, data_type text);
END;
$_$;


ALTER FUNCTION public.diagnosticar_colunas_estrutura_aworks() OWNER TO postgres;

--
-- TOC entry 633 (class 1255 OID 16361062)
-- Name: diagnosticar_id_cache_estrutura_aworks(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.diagnosticar_id_cache_estrutura_aworks(p_id_cache integer) RETURNS TABLE(coluna text, ocorrencias bigint)
    LANGUAGE plpgsql
    AS $_$
DECLARE
  conn text := current_setting('app.aworks_dblink_conn', true);
  r record;
  sql_count text;
  v_count bigint;
BEGIN
  IF conn IS NULL OR btrim(conn) = '' THEN
    RAISE EXCEPTION 'Parametro app.aworks_dblink_conn nao configurado';
  END IF;

  IF p_id_cache IS NULL OR p_id_cache <= 0 THEN
    RAISE EXCEPTION 'Informe um id_cache valido';
  END IF;

  FOR r IN
    SELECT t.column_name
    FROM dblink(
      conn,
      $aw$
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'estrutura'
        AND data_type IN (
          'smallint',
          'integer',
          'bigint',
          'numeric',
          'real',
          'double precision'
        )
      ORDER BY ordinal_position
      $aw$
    ) AS t(column_name text)
  LOOP
    sql_count := format(
      'SELECT COUNT(*)::bigint AS total FROM public.estrutura WHERE %1$I::numeric = %2$s',
      r.column_name,
      p_id_cache
    );

    BEGIN
      SELECT q.total
      INTO v_count
      FROM dblink(conn, sql_count) AS q(total bigint);
    EXCEPTION WHEN OTHERS THEN
      v_count := 0;
    END;

    IF COALESCE(v_count, 0) > 0 THEN
      coluna := r.column_name;
      ocorrencias := v_count;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$_$;


ALTER FUNCTION public.diagnosticar_id_cache_estrutura_aworks(p_id_cache integer) OWNER TO postgres;

--
-- TOC entry 706 (class 1255 OID 16356120)
-- Name: expandir_campos_produtos_por_aworks(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.expandir_campos_produtos_por_aworks() RETURNS TABLE(coluna text, tipo text, acao text)
    LANGUAGE plpgsql
    AS $_$
DECLARE
  conn text := current_setting('app.aworks_dblink_conn', true);
  r record;
  existe_local boolean;
  ignorar_colunas text[] := ARRAY[
    'produtoid',
    'referencia_produto',
    'ds_produto',
    'tp_produto',
    'vl_pesobruto_produto',
    'subgrupoprodutoid',
    'grupoprodutoid'
  ];
BEGIN
  IF conn IS NULL OR btrim(conn) = '' THEN
    RAISE EXCEPTION 'Parametro app.aworks_dblink_conn nao configurado';
  END IF;

  FOR r IN
    SELECT aw.column_name, aw.data_type
    FROM dblink(
      conn,
      $aw$
      SELECT
        a.attname AS column_name,
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type
      FROM pg_attribute a
      INNER JOIN pg_class c ON c.oid = a.attrelid
      INNER JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'produto'
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
      $aw$
    ) AS aw(column_name text, data_type text)
  LOOP
    IF r.column_name = ANY(ignorar_colunas) THEN
      coluna := r.column_name;
      tipo := r.data_type;
      acao := 'IGNORADA';
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'produtos'
        AND c.column_name = r.column_name
    ) INTO existe_local;

    IF existe_local THEN
      coluna := r.column_name;
      tipo := r.data_type;
      acao := 'JA_EXISTE';
      RETURN NEXT;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.produtos ADD COLUMN %I %s;', r.column_name, r.data_type);
    EXECUTE format(
      'COMMENT ON COLUMN public.produtos.%I IS ''Campo espelhado de AWORKS.public.produto'';',
      r.column_name
    );

    coluna := r.column_name;
    tipo := r.data_type;
    acao := 'CRIADA';
    RETURN NEXT;
  END LOOP;
END;
$_$;


ALTER FUNCTION public.expandir_campos_produtos_por_aworks() OWNER TO postgres;

--
-- TOC entry 566 (class 1255 OID 6208171)
-- Name: finalizar_separacao_parcial(integer, numeric, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.finalizar_separacao_parcial(p_pedidovendaitemid integer, p_quantidade_separada numeric, p_id_operador integer, p_observacao text DEFAULT NULL::text) RETURNS TABLE(sucesso boolean, mensagem character varying, quantidade_restante numeric)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_item RECORD;
    v_quantidade_restante NUMERIC;
    v_pedidovendaid INTEGER;
BEGIN
    SELECT
        si.id,
        si.id_separacao_pedido,
        si.quantidade_solicitada,
        si.quantidade_conferida,
        si.quantidade_separada_inicial,
        si.data_bloqueio,
        si.bloqueado_por
    INTO v_item
    FROM public.separacao_itens si
    WHERE si.pedidovendaitemid = p_pedidovendaitemid
    ORDER BY CASE WHEN si.bloqueado_por IS NOT NULL THEN 0 ELSE 1 END,
             si.data_bloqueio DESC NULLS LAST,
             si.updated_at DESC NULLS LAST,
             si.id DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND OR v_item.bloqueado_por IS NULL OR v_item.bloqueado_por != p_id_operador THEN
        RETURN QUERY SELECT
            FALSE,
            'Item não está bloqueado por este operador ou não foi encontrado'::VARCHAR(500),
            0::NUMERIC;
        RETURN;
    END IF;

    SELECT sp.pedidovendaid
      INTO v_pedidovendaid
    FROM public.separacao_pedidos sp
    WHERE sp.id = v_item.id_separacao_pedido;

    v_quantidade_restante := v_item.quantidade_solicitada - p_quantidade_separada;

    IF v_quantidade_restante < 0 THEN
        v_quantidade_restante := 0;
    END IF;

    INSERT INTO public.separacao_itens_bloqueio (
        pedidovendaitemid,
        pedidovendaid,
        bloqueado_por,
        desbloqueado_por,
        data_bloqueio,
        data_desbloqueio,
        quantidade_solicitada,
        quantidade_separada_quando_bloqueado,
        quantidade_separada_quando_desbloqueado,
        motivo_desbloqueio,
        observacoes
    ) VALUES (
        p_pedidovendaitemid,
        v_pedidovendaid,
        v_item.bloqueado_por,
        p_id_operador,
        v_item.data_bloqueio,
        CURRENT_TIMESTAMP,
        v_item.quantidade_solicitada,
        v_item.quantidade_separada_inicial,
        p_quantidade_separada,
        'FINALIZADO_PARCIAL',
        p_observacao
    );

    UPDATE public.separacao_itens
    SET bloqueado_por = NULL,
        data_bloqueio = NULL,
        updated_at = NOW()
    WHERE id = v_item.id;

    RETURN QUERY SELECT
        TRUE,
        ('Separação parcial finalizada. Quantidade restante (' || v_quantidade_restante::VARCHAR || ') liberada para outro operador')::VARCHAR(500),
        v_quantidade_restante;
END;
$$;


ALTER FUNCTION public.finalizar_separacao_parcial(p_pedidovendaitemid integer, p_quantidade_separada numeric, p_id_operador integer, p_observacao text) OWNER TO postgres;

--
-- TOC entry 6429 (class 0 OID 0)
-- Dependencies: 566
-- Name: FUNCTION finalizar_separacao_parcial(p_pedidovendaitemid integer, p_quantidade_separada numeric, p_id_operador integer, p_observacao text); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.finalizar_separacao_parcial(p_pedidovendaitemid integer, p_quantidade_separada numeric, p_id_operador integer, p_observacao text) IS 'Finaliza a separação parcial de um item e libera a quantidade restante';


--
-- TOC entry 642 (class 1255 OID 9967770)
-- Name: fn_auditar_contagem_estoque(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_auditar_contagem_estoque() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_operador INTEGER;
  v_origem_modulo VARCHAR(80);
  v_origem_tipo VARCHAR(80);
  v_referencia_mov VARCHAR(80);
  v_id_referencia BIGINT;
  v_observacao TEXT;
  v_qtd_anterior NUMERIC(15,6);
  v_qtd_atual NUMERIC(15,6);
BEGIN
  v_origem_modulo := COALESCE(NULLIF(current_setting('app.origem_modulo', true), ''), 'SEM_CONTEXTO');
  v_origem_tipo := COALESCE(NULLIF(current_setting('app.origem_tipo', true), ''), TG_OP);
  v_referencia_mov := NULLIF(current_setting('app.referencia_movimento', true), '');
  v_id_referencia := public.fn_obter_bigint_setting('app.id_referencia');
  v_observacao := NULLIF(current_setting('app.observacao', true), '');

  IF TG_OP = 'INSERT' THEN
    v_qtd_anterior := NULL;
    v_qtd_atual := COALESCE(NEW.quantidade_pacotes, 0);
    v_operador := COALESCE(public.fn_obter_int_setting('app.user_id'), NEW.id_operador);
    v_observacao := COALESCE(v_observacao, NEW.observacao);

    INSERT INTO public.estoque_auditoria_eventos (
      tabela_origem, operacao, id_registro,
      id_produto, id_posicao, id_local_estoque, id_inventario,
      quantidade_anterior, quantidade_atual, delta_quantidade,
      id_operador, origem_modulo, origem_tipo,
      referencia_movimento, id_referencia,
      observacao, row_old, row_new
    ) VALUES (
      TG_TABLE_NAME, TG_OP, NEW.id,
      NEW.id_produto, NEW.id_posicao, NEW.id_local_estoque, NEW.id_inventario,
      v_qtd_anterior, v_qtd_atual, v_qtd_atual,
      v_operador, v_origem_modulo, v_origem_tipo,
      v_referencia_mov, v_id_referencia,
      v_observacao, NULL, to_jsonb(NEW)
    );

    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_qtd_anterior := COALESCE(OLD.quantidade_pacotes, 0);
    v_qtd_atual := COALESCE(NEW.quantidade_pacotes, 0);
    v_operador := COALESCE(public.fn_obter_int_setting('app.user_id'), NEW.id_operador, OLD.id_operador);
    v_observacao := COALESCE(v_observacao, NEW.observacao, OLD.observacao);

    INSERT INTO public.estoque_auditoria_eventos (
      tabela_origem, operacao, id_registro,
      id_produto, id_posicao, id_local_estoque, id_inventario,
      quantidade_anterior, quantidade_atual, delta_quantidade,
      id_operador, origem_modulo, origem_tipo,
      referencia_movimento, id_referencia,
      observacao, row_old, row_new
    ) VALUES (
      TG_TABLE_NAME, TG_OP, NEW.id,
      NEW.id_produto, NEW.id_posicao, NEW.id_local_estoque, NEW.id_inventario,
      v_qtd_anterior, v_qtd_atual, (v_qtd_atual - v_qtd_anterior),
      v_operador, v_origem_modulo, v_origem_tipo,
      v_referencia_mov, v_id_referencia,
      v_observacao, to_jsonb(OLD), to_jsonb(NEW)
    );

    RETURN NEW;
  ELSE
    v_qtd_anterior := COALESCE(OLD.quantidade_pacotes, 0);
    v_qtd_atual := NULL;
    v_operador := COALESCE(public.fn_obter_int_setting('app.user_id'), OLD.id_operador);
    v_observacao := COALESCE(v_observacao, OLD.observacao);

    INSERT INTO public.estoque_auditoria_eventos (
      tabela_origem, operacao, id_registro,
      id_produto, id_posicao, id_local_estoque, id_inventario,
      quantidade_anterior, quantidade_atual, delta_quantidade,
      id_operador, origem_modulo, origem_tipo,
      referencia_movimento, id_referencia,
      observacao, row_old, row_new
    ) VALUES (
      TG_TABLE_NAME, TG_OP, OLD.id,
      OLD.id_produto, OLD.id_posicao, OLD.id_local_estoque, OLD.id_inventario,
      v_qtd_anterior, v_qtd_atual, (-1 * v_qtd_anterior),
      v_operador, v_origem_modulo, v_origem_tipo,
      v_referencia_mov, v_id_referencia,
      v_observacao, to_jsonb(OLD), NULL
    );

    RETURN OLD;
  END IF;
END;
$$;


ALTER FUNCTION public.fn_auditar_contagem_estoque() OWNER TO postgres;

--
-- TOC entry 559 (class 1255 OID 9967769)
-- Name: fn_obter_bigint_setting(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_obter_bigint_setting(p_setting text) RETURNS bigint
    LANGUAGE plpgsql
    AS $_$
DECLARE
  v_value TEXT;
BEGIN
  v_value := NULLIF(current_setting(p_setting, true), '');
  IF v_value IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_value ~ '^-?[0-9]+$' THEN
    RETURN v_value::BIGINT;
  END IF;

  RETURN NULL;
END;
$_$;


ALTER FUNCTION public.fn_obter_bigint_setting(p_setting text) OWNER TO postgres;

--
-- TOC entry 695 (class 1255 OID 9967768)
-- Name: fn_obter_int_setting(text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_obter_int_setting(p_setting text) RETURNS integer
    LANGUAGE plpgsql
    AS $_$
DECLARE
  v_value TEXT;
BEGIN
  v_value := NULLIF(current_setting(p_setting, true), '');
  IF v_value IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_value ~ '^-?[0-9]+$' THEN
    RETURN v_value::INTEGER;
  END IF;

  RETURN NULL;
END;
$_$;


ALTER FUNCTION public.fn_obter_int_setting(p_setting text) OWNER TO postgres;

--
-- TOC entry 604 (class 1255 OID 16424346)
-- Name: gerar_numero_requisicao(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.gerar_numero_requisicao() RETURNS character varying
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_ano VARCHAR(4);
    v_seq INTEGER;
BEGIN
    v_ano := TO_CHAR(CURRENT_DATE, 'YYYY');

    SELECT COALESCE(MAX(CAST(SUBSTRING(numero_requisicao FROM 10) AS INTEGER)), 0) + 1
      INTO v_seq
      FROM requisicao_compra
     WHERE numero_requisicao LIKE 'REQ-' || v_ano || '-%';

    RETURN 'REQ-' || v_ano || '-' || LPAD(v_seq::TEXT, 4, '0');
END;
$$;


ALTER FUNCTION public.gerar_numero_requisicao() OWNER TO postgres;

--
-- TOC entry 681 (class 1255 OID 16424347)
-- Name: gerar_requisicoes_compra(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.gerar_requisicoes_compra(p_horizonte_dias integer DEFAULT 30, p_id_operador integer DEFAULT NULL::integer) RETURNS TABLE(requisicoes_geradas integer, mensagem text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_item RECORD;
    v_qtd NUMERIC;
    v_num VARCHAR(20);
    v_count INT := 0;
BEGIN
    FOR v_item IN
        SELECT
            p.id,
            p.referencia_produto,
            p.ponto_pedido,
            p.estoque_minimo,
            p.lote_compra,
            p.lead_time_compra_dias,
            COALESCE(SUM(ce.quantidade_pacotes), 0) AS estoque_atual,
            COALESCE((
                SELECT SUM(ep.quantidade_necessaria)
                  FROM ordem_producao op
                  JOIN ordem_producao_necessidades ep
                    ON op.id = ep.id_ordem_producao
                 WHERE ep.id_produto_local = p.id
                   AND op.status IN ('PENDENTE', 'PLANEJADO', 'EM_ANDAMENTO')
                   AND COALESCE(op.data_inicio, NOW()) <= NOW() + (p_horizonte_dias || ' days')::INTERVAL
            ), 0) AS demanda_futura
        FROM produtos p
        LEFT JOIN contagem_estoque ce ON p.id_cache = ce.id_produto
        WHERE p.tp_produto = 'MATPRIMA'
          AND COALESCE(p.ativo, TRUE) = TRUE
        GROUP BY p.id, p.referencia_produto, p.ponto_pedido, p.estoque_minimo, p.lote_compra, p.lead_time_compra_dias
        HAVING COALESCE(SUM(ce.quantidade_pacotes), 0) < COALESCE(p.ponto_pedido, 0)
            OR COALESCE(SUM(ce.quantidade_pacotes), 0) < COALESCE(p.estoque_minimo, 0)
            OR COALESCE((
                SELECT SUM(ep.quantidade_necessaria)
                  FROM ordem_producao op
                  JOIN ordem_producao_necessidades ep
                    ON op.id = ep.id_ordem_producao
                 WHERE ep.id_produto_local = p.id
                   AND op.status IN ('PENDENTE', 'PLANEJADO', 'EM_ANDAMENTO')
                   AND COALESCE(op.data_inicio, NOW()) <= NOW() + (p_horizonte_dias || ' days')::INTERVAL
            ), 0) > 0
    LOOP
        v_qtd := COALESCE(v_item.estoque_minimo, 0)
                 + COALESCE(v_item.demanda_futura, 0)
                 - COALESCE(v_item.estoque_atual, 0);

        IF v_qtd > 0 AND COALESCE(v_item.lote_compra, 0) > 0 THEN
            v_qtd := CEIL(v_qtd / v_item.lote_compra) * v_item.lote_compra;
        END IF;

        IF v_qtd <= 0 THEN
            CONTINUE;
        END IF;

        IF EXISTS (
            SELECT 1
              FROM requisicao_compra
             WHERE id_produto = v_item.id
               AND status NOT IN ('CANCELADA', 'COMPRADA')
        ) THEN
            UPDATE requisicao_compra
               SET quantidade_necessaria = quantidade_necessaria + v_qtd,
                   quantidade_solicitada = quantidade_solicitada + v_qtd,
                   data_necessidade = LEAST(
                       data_necessidade,
                       CURRENT_DATE + COALESCE(v_item.lead_time_compra_dias, 0)
                   ),
                   updated_at = NOW()
             WHERE id_produto = v_item.id
               AND status NOT IN ('CANCELADA', 'COMPRADA');

            v_count := v_count + 1;
        ELSE
            v_num := gerar_numero_requisicao();

            INSERT INTO requisicao_compra (
                numero_requisicao,
                id_produto,
                quantidade_necessaria,
                quantidade_solicitada,
                unidade,
                data_necessidade,
                status,
                id_operador_compra,
                observacoes
            ) VALUES (
                v_num,
                v_item.id,
                v_qtd,
                v_qtd,
                'KG',
                CURRENT_DATE + COALESCE(v_item.lead_time_compra_dias, 0),
                'PENDENTE',
                p_id_operador,
                'MRP: Estoque=' || COALESCE(v_item.estoque_atual, 0) || ', Ponto=' || COALESCE(v_item.ponto_pedido, 0)
            );

            v_count := v_count + 1;
        END IF;
    END LOOP;

    RETURN QUERY SELECT v_count, 'Requisicoes geradas com sucesso';
END;
$$;


ALTER FUNCTION public.gerar_requisicoes_compra(p_horizonte_dias integer, p_id_operador integer) OWNER TO postgres;

--
-- TOC entry 650 (class 1255 OID 16808784)
-- Name: job_atualizar_divergencias(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.job_atualizar_divergencias() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Atualizar a view materializada
    REFRESH MATERIALIZED VIEW CONCURRENTLY pedido_itens_aworks_simples_mv;
    
    -- Detectar divergências
    PERFORM detectar_divergencias();
    
    -- Log (opcional)
    INSERT INTO logs_sistema (tipo, mensagem, data_criacao)
    VALUES ('INFO', 'Job de divergências executado em ' || NOW()::text, NOW());
EXCEPTION WHEN OTHERS THEN
    -- Ignora erro se tabela logs_sistema não existir
    RAISE NOTICE 'Erro no job: %', SQLERRM;
END;
$$;


ALTER FUNCTION public.job_atualizar_divergencias() OWNER TO postgres;

--
-- TOC entry 672 (class 1255 OID 3277430)
-- Name: job_sincronizacao_pedidos(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.job_sincronizacao_pedidos() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Executar a sincronização a cada hora
  PERFORM sincronizar_pedidos_separacao();
  
  -- Log da execução
  INSERT INTO logs_sistema (tipo, mensagem) 
  VALUES ('INFO', 'Job de sincronização de pedidos executado em ' || NOW()::text);
END;
$$;


ALTER FUNCTION public.job_sincronizacao_pedidos() OWNER TO postgres;

--
-- TOC entry 627 (class 1255 OID 105058)
-- Name: obter_meta_horaria_produto(integer, character varying); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.obter_meta_horaria_produto(p_id_produto integer, p_tipo_maquina character varying) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_meta_horaria INTEGER;
    v_tempo_padrao DECIMAL(10,2);
    v_pecas_por_ciclo INTEGER;
BEGIN
    -- Tentar obter meta específica primeiro
    SELECT 
        CASE 
            WHEN p_tipo_maquina = 'MONTAGEM' THEN meta_horaria_montagem
            WHEN p_tipo_maquina = 'EMBALAGEM' THEN meta_horaria_embalagem
            WHEN p_tipo_maquina = 'INJETORA' THEN meta_horaria_injecao
            ELSE NULL
        END,
        pecas_por_ciclo
    INTO v_meta_horaria, v_pecas_por_ciclo
    FROM produtos 
    WHERE id = p_id_produto;
    
    -- Se não tem meta específica, calcular baseado no tempo padrão
    IF v_meta_horaria IS NULL THEN
        v_tempo_padrao := obter_tempo_padrao_produto(p_id_produto, p_tipo_maquina);
        IF v_tempo_padrao > 0 THEN
            v_meta_horaria := (3600 / v_tempo_padrao) * COALESCE(v_pecas_por_ciclo, 1);
        END IF;
    END IF;
    
    RETURN v_meta_horaria;
END;
$$;


ALTER FUNCTION public.obter_meta_horaria_produto(p_id_produto integer, p_tipo_maquina character varying) OWNER TO postgres;

--
-- TOC entry 689 (class 1255 OID 105057)
-- Name: obter_tempo_padrao_produto(integer, character varying); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.obter_tempo_padrao_produto(p_id_produto integer, p_tipo_maquina character varying) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_tempo_padrao DECIMAL(10,2);
BEGIN
    SELECT 
        CASE 
            WHEN p_tipo_maquina = 'MONTAGEM' THEN tempo_padrao_montagem_segundos
            WHEN p_tipo_maquina = 'EMBALAGEM' THEN tempo_padrao_embalagem_segundos
            WHEN p_tipo_maquina = 'INJETORA' THEN tempo_padrao_injecao_segundos
            ELSE NULL
        END
    INTO v_tempo_padrao
    FROM produtos 
    WHERE id = p_id_produto;
    
    RETURN v_tempo_padrao;
END;
$$;


ALTER FUNCTION public.obter_tempo_padrao_produto(p_id_produto integer, p_tipo_maquina character varying) OWNER TO postgres;

--
-- TOC entry 692 (class 1255 OID 78891)
-- Name: original_to_cache_id(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.original_to_cache_id(original_id integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    cache_id INTEGER;
BEGIN
    SELECT id_cache INTO cache_id 
    FROM produto_id_mapping 
    WHERE id_original = original_id AND ativo = true
    LIMIT 1;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mapeamento não encontrado para ID original %', original_id;
    END IF;
    
    RETURN cache_id;
END;
$$;


ALTER FUNCTION public.original_to_cache_id(original_id integer) OWNER TO postgres;

--
-- TOC entry 682 (class 1255 OID 6060480)
-- Name: processar_saida_kardex(integer, integer, integer, integer, timestamp without time zone); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.processar_saida_kardex(p_kardexid_entrada integer, p_kardexid_saida integer, p_quantidade_saida integer, p_usuarioid integer, p_dt_saida timestamp without time zone) RETURNS TABLE(sucesso boolean, mensagem character varying, entrada_id integer, quantidade_restante integer)
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_entrada_id INT;
      v_quantidade_total INT;
      v_quantidade_recebida INT;
      v_quantidade_restante INT;
      v_log_existente RECORD;
      v_linhas_log INT;
    BEGIN
      -- Idempotencia: se a saida ja foi processada, nao processar novamente.
      SELECT id, kardexid_entrada_original
      INTO v_log_existente
      FROM entrada_producao_saidas_log
      WHERE kardexid_saida = p_kardexid_saida
        AND status = 'PROCESSADO'
      ORDER BY id DESC
      LIMIT 1;

      IF v_log_existente.id IS NOT NULL THEN
        SELECT id, quantidade_total, quantidade_recebida
        INTO v_entrada_id, v_quantidade_total, v_quantidade_recebida
        FROM entrada_producao
        WHERE kardexid = v_log_existente.kardexid_entrada_original
        ORDER BY id DESC
        LIMIT 1;

        IF v_entrada_id IS NOT NULL THEN
          v_quantidade_restante := COALESCE(v_quantidade_total, 0) - COALESCE(v_quantidade_recebida, 0);
        ELSE
          v_quantidade_restante := NULL;
        END IF;

        RETURN QUERY SELECT
          TRUE::BOOLEAN,
          'Saida ja processada anteriormente (idempotente)'::VARCHAR,
          v_entrada_id::INT,
          v_quantidade_restante::INT;
        RETURN;
      END IF;

      -- 1. Buscar entrada original pelo kardexid
      SELECT id, quantidade_total, quantidade_recebida
      INTO v_entrada_id, v_quantidade_total, v_quantidade_recebida
      FROM entrada_producao
      WHERE kardexid = p_kardexid_entrada
      ORDER BY id DESC
      LIMIT 1;

      -- Se nao encontrou entrada, registrar saida sem processamento (somente uma vez)
      IF v_entrada_id IS NULL THEN
        INSERT INTO entrada_producao_saidas_log (
          kardexid_saida, kardexid_entrada_original, produtoid, quantidade_saida,
          usuarioid, dt_saida, status, observacoes
        )
        SELECT
          p_kardexid_saida, p_kardexid_entrada, NULL, ABS(p_quantidade_saida),
          p_usuarioid, p_dt_saida, 'PENDENTE', 'Entrada original nao encontrada - saida registrada'
        WHERE NOT EXISTS (
          SELECT 1 FROM entrada_producao_saidas_log WHERE kardexid_saida = p_kardexid_saida
        );

        RETURN QUERY SELECT
          TRUE::BOOLEAN,
          'Saida registrada mas entrada original nao encontrada'::VARCHAR,
          NULL::INT,
          NULL::INT;
        RETURN;
      END IF;

      -- 2. Calcular quantidade restante apos saida
      v_quantidade_restante := v_quantidade_total - ABS(p_quantidade_saida);

      -- 3. Atualizar entrada_producao
      UPDATE entrada_producao
      SET
        quantidade_removida = COALESCE(quantidade_removida, 0) + ABS(p_quantidade_saida),
        status_remocao = CASE
          WHEN (quantidade_total - (COALESCE(quantidade_removida, 0) + ABS(p_quantidade_saida))) <= 0 THEN 'COMPLETAMENTE_REMOVIDO'
          WHEN ABS(p_quantidade_saida) > 0 THEN 'PARCIALMENTE_REMOVIDO'
          ELSE 'ATIVO'
        END,
        updated_at = NOW()
      WHERE id = v_entrada_id;

      -- 4. Registrar no log de saidas sem duplicar kardexid_saida
      INSERT INTO entrada_producao_saidas_log (
        kardexid_saida, kardexid_entrada_original, produtoid, quantidade_saida,
        usuarioid, dt_saida, status
      )
      SELECT
        p_kardexid_saida, p_kardexid_entrada, NULL, ABS(p_quantidade_saida),
        p_usuarioid, p_dt_saida, 'PROCESSADO'
      WHERE NOT EXISTS (
        SELECT 1 FROM entrada_producao_saidas_log WHERE kardexid_saida = p_kardexid_saida
      );

      GET DIAGNOSTICS v_linhas_log = ROW_COUNT;

      IF v_linhas_log = 0 THEN
        RETURN QUERY SELECT
          TRUE::BOOLEAN,
          'Saida ja registrada no log (idempotente)'::VARCHAR,
          v_entrada_id::INT,
          v_quantidade_restante::INT;
        RETURN;
      END IF;

      -- 5. Se quantidade ficou <= 0, marcar como REMOVIDO
      IF v_quantidade_restante <= 0 THEN
        UPDATE entrada_producao
        SET status = 'REMOVIDO', status_remocao = 'COMPLETAMENTE_REMOVIDO'
        WHERE id = v_entrada_id;
      END IF;

      RETURN QUERY SELECT
        TRUE::BOOLEAN,
        'Saida processada com sucesso'::VARCHAR,
        v_entrada_id::INT,
        v_quantidade_restante::INT;
    END;
    $$;


ALTER FUNCTION public.processar_saida_kardex(p_kardexid_entrada integer, p_kardexid_saida integer, p_quantidade_saida integer, p_usuarioid integer, p_dt_saida timestamp without time zone) OWNER TO postgres;

--
-- TOC entry 634 (class 1255 OID 4333194)
-- Name: reservar_estoque_pedido(integer, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.reservar_estoque_pedido(p_pedidovendaid integer, p_id_operador integer) RETURNS TABLE(sucesso boolean, mensagem text, quantidade_reservas integer, quantidade_faltantes integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_item RECORD;
    v_endereco RECORD;
    v_quantidade_faltante NUMERIC(15,4);
    v_quantidade_a_reservar NUMERIC(15,4);
    v_prioridade VARCHAR(20);
    v_total_reservas INTEGER := 0;
    v_total_faltantes INTEGER := 0;
    v_id_separacao INTEGER;
BEGIN
    -- Calcular prioridade do pedido
    v_prioridade := public.calcular_prioridade_pedido(p_pedidovendaid);
    
    -- Buscar ID da separação
    SELECT id INTO v_id_separacao 
    FROM separacao_pedidos 
    WHERE pedidovendaid = p_pedidovendaid;
    
    IF v_id_separacao IS NULL THEN
        RETURN QUERY SELECT false, 'Separação não encontrada', 0, 0;
        RETURN;
    END IF;
    
    -- Loop por cada item do pedido
    FOR v_item IN 
        SELECT 
            si.id AS pedidovendaitemid,
            si.id_produto AS produtoid,
            si.quantidade_solicitada,
            COALESCE(si.quantidade_separada, 0) AS quantidade_separada
        FROM separacao_itens si
        WHERE si.id_separacao_pedido = v_id_separacao
        AND si.status = 'PENDENTE'
    LOOP
        -- Calcular quantidade pendente
        v_quantidade_faltante := v_item.quantidade_solicitada - v_item.quantidade_separada;
        
        IF v_quantidade_faltante > 0 THEN
            -- Buscar endereços disponíveis ordenados por quantidade (maior para menor)
            FOR v_endereco IN
                SELECT 
                    pos.id AS id_posicao,
                    e.quantidade AS quantidade_disponivel
                FROM estoque e
                JOIN posicoes pos ON e.posicao_id = pos.id
                WHERE e.produto_id = v_item.produtoid
                AND e.quantidade > 0
                ORDER BY e.quantidade DESC
            LOOP
                -- Quantidade a reservar é o mínimo entre disponível e faltante
                v_quantidade_a_reservar := LEAST(
                    v_endereco.quantidade_disponivel,
                    v_quantidade_faltante
                );
                
                -- Inserir reserva
                INSERT INTO public.reservas_estoque (
                    pedidovendaid,
                    pedidovendaitemid,
                    id_posicao,
                    quantidade_reservada,
                    status,
                    prioridade_pedido,
                    id_operador_reserva
                ) VALUES (
                    p_pedidovendaid,
                    v_item.pedidovendaitemid,
                    v_endereco.id_posicao,
                    v_quantidade_a_reservar,
                    'ATIVA',
                    v_prioridade,
                    p_id_operador
                );
                
                v_total_reservas := v_total_reservas + 1;
                v_quantidade_faltante := v_quantidade_faltante - v_quantidade_a_reservar;
                
                -- Se já reservou tudo, sair do loop
                EXIT WHEN v_quantidade_faltante <= 0;
            END LOOP;
            
            -- Se ainda faltou estoque
            IF v_quantidade_faltante > 0 THEN
                v_total_faltantes := v_total_faltantes + 1;
            END IF;
        END IF;
    END LOOP;
    
    -- Retornar resultado
    RETURN QUERY SELECT 
        (v_total_faltantes = 0)::BOOLEAN,
        CASE 
            WHEN v_total_faltantes = 0 THEN 'Estoque reservado com sucesso para ' || v_total_reservas || ' endereços'
            ELSE 'Reserva parcial: ' || v_total_reservas || ' endereços, ' || v_total_faltantes || ' itens com falta'
        END,
        v_total_reservas,
        v_total_faltantes;
END;
$$;


ALTER FUNCTION public.reservar_estoque_pedido(p_pedidovendaid integer, p_id_operador integer) OWNER TO postgres;

--
-- TOC entry 6439 (class 0 OID 0)
-- Dependencies: 634
-- Name: FUNCTION reservar_estoque_pedido(p_pedidovendaid integer, p_id_operador integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.reservar_estoque_pedido(p_pedidovendaid integer, p_id_operador integer) IS 'Reserva estoque para todos os itens de um pedido, respeitando a disponibilidade de cada endereço';


--
-- TOC entry 610 (class 1255 OID 16735711)
-- Name: resolver_divergencia(integer, integer, text); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.resolver_divergencia(p_id integer, p_resolvido_por integer, p_observacoes text DEFAULT NULL::text) RETURNS TABLE(sucesso boolean, mensagem text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_existe BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM divergencias_estoque 
        WHERE id = p_id AND status = 'PENDENTE'
    ) INTO v_existe;
    
    IF NOT v_existe THEN
        sucesso := false;
        mensagem := 'Divergência não encontrada ou já resolvida';
        RETURN NEXT;
        RETURN;
    END IF;
    
    UPDATE divergencias_estoque
    SET 
        status = 'RESOLVIDO',
        data_resolucao = NOW(),
        resolvido_por = p_resolvido_por,
        observacoes = COALESCE(observacoes || E'\n', '') || p_observacoes
    WHERE id = p_id;
    
    sucesso := true;
    mensagem := 'Divergência resolvida com sucesso';
    RETURN NEXT;
END;
$$;


ALTER FUNCTION public.resolver_divergencia(p_id integer, p_resolvido_por integer, p_observacoes text) OWNER TO postgres;

--
-- TOC entry 652 (class 1255 OID 16357212)
-- Name: reverter_colunas_espelhadas_produtos(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.reverter_colunas_espelhadas_produtos() RETURNS TABLE(coluna text, acao text, detalhe text)
    LANGUAGE plpgsql
    AS $$
DECLARE
  r record;
  colunas_protegidas text[] := ARRAY[
    'id',
    'referencia_produto',
    'ds_produto',
    'ean13',
    'id_cache',
    'updated_at'
  ];
BEGIN
  FOR r IN
    SELECT
      c.column_name,
      pgd.description AS comentario
    FROM information_schema.columns c
    LEFT JOIN pg_catalog.pg_statio_all_tables st
      ON st.schemaname = c.table_schema
     AND st.relname = c.table_name
    LEFT JOIN pg_catalog.pg_description pgd
      ON pgd.objoid = st.relid
     AND pgd.objsubid = c.ordinal_position
    WHERE c.table_schema = 'public'
      AND c.table_name = 'produtos'
  LOOP
    IF r.column_name = ANY(colunas_protegidas) THEN
      coluna := r.column_name;
      acao := 'MANTIDA';
      detalhe := 'Coluna protegida para vinculo da estrutura';
      RETURN NEXT;
      CONTINUE;
    END IF;

    IF COALESCE(r.comentario, '') <> 'Campo espelhado de AWORKS.public.produto' THEN
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format('ALTER TABLE public.produtos DROP COLUMN %I;', r.column_name);
      coluna := r.column_name;
      acao := 'REMOVIDA';
      detalhe := 'Removida por ser espelhamento desnecessario';
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      coluna := r.column_name;
      acao := 'NAO_REMOVIDA';
      detalhe := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;


ALTER FUNCTION public.reverter_colunas_espelhadas_produtos() OWNER TO postgres;

--
-- TOC entry 674 (class 1255 OID 74596)
-- Name: schedule_cache_refresh(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.schedule_cache_refresh() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_catalog.pg_sleep(3600); -- Espera 1 hora
  PERFORM public.atualizar_produtos_cache();
END;
$$;


ALTER FUNCTION public.schedule_cache_refresh() OWNER TO postgres;

--
-- TOC entry 631 (class 1255 OID 3430627)
-- Name: sincronizar_pedidos_separacao(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sincronizar_pedidos_separacao() RETURNS integer
    LANGUAGE plpgsql
    AS $$
      DECLARE
        pedidos_inseridos INTEGER := 0;
      BEGIN
        -- Inserir TODOS os pedidos com itens pendentes
        INSERT INTO separacao_pedidos (
          pedidovendaid, 
          nr_nota_fiscal, 
          cliente_nome, 
          status, 
          observacoes,
          created_at
        )
        SELECT 
          pd.id,
          pd.nr_nota_pedidovenda,
          pd.cliente_nome,
          'PENDENTE',
          'Pedido ' || COALESCE(pd.prioridade, 'NÃO INFORMADA') || ' - Sincronizado: ' || NOW()::date,
          NOW()
        FROM vw_pedidos_despacho_completo pd
        WHERE pd.id NOT IN (SELECT pedidovendaid FROM separacao_pedidos)
          AND EXISTS (
            SELECT 1 
            FROM vw_pedido_itens_aworks_simples pi 
            WHERE pi.pedidovendaid = pd.id
              AND (pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, 0)) > 0
          )
        ORDER BY 
          CASE COALESCE(pd.prioridade, '')
            WHEN 'VERMELHO' THEN 1
            WHEN 'LARANJA' THEN 2
            WHEN 'AMARELO' THEN 3
            WHEN 'VERDE' THEN 4
            WHEN 'ROXO' THEN 5
            ELSE 6
          END,
          pd.dt_faturamento_pedidovenda
        ON CONFLICT (pedidovendaid) DO NOTHING;
        
        GET DIAGNOSTICS pedidos_inseridos = ROW_COUNT;
        
        RAISE NOTICE '✅ Sincronização concluída: % novos pedidos inseridos', pedidos_inseridos;
        
        RETURN pedidos_inseridos;
      END;
      $$;


ALTER FUNCTION public.sincronizar_pedidos_separacao() OWNER TO postgres;

--
-- TOC entry 686 (class 1255 OID 6060481)
-- Name: sincronizar_saidas_kardex(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sincronizar_saidas_kardex() RETURNS TABLE(processadas integer, erros integer, mensagem character varying)
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_processadas INT := 0;
      v_erros INT := 0;
      v_saida RECORD;
    BEGIN
      FOR v_saida IN
        SELECT DISTINCT
          k1.kardexid::INT as kardexid_saida,
          k1.produtoid::INT as produtoid,
          k1.qt_kardex as quantidade_saida,
          k1.usuarioid::INT as usuarioid,
          k1.dt_kardex,
          k1.tipo_kerdex as tipo_kardex,
          (
            SELECT ep.kardexid
            FROM entrada_producao ep
            WHERE ep.produtoid = k1.produtoid::INT
              AND ep.usuario_origem = k1.usuarioid::INT
              AND ep.data_kardex < k1.dt_kardex
            ORDER BY ep.data_kardex DESC, ep.id DESC
            LIMIT 1
          )::INT as kardexid_entrada
        FROM (
          SELECT * FROM dblink(
            'hostaddr=192.168.10.252 port=5432 dbname=AWORKSDB user=postgres password=aw2000',
            'SELECT kardexid, produtoid, qt_kardex, usuarioid, dt_kardex, tipo_kerdex, Qt_estoque_total_kardex
             FROM kardex
             WHERE tipo_kerdex = ''SAIDA''
               AND usuarioid IN (140, 141, 142, 143, 144, 145, 146, 148, 149, 150, 151, 152)
               AND dt_kardex >= NOW() - INTERVAL ''72 hours''
             ORDER BY dt_kardex DESC'
          ) AS k1(kardexid NUMERIC, produtoid NUMERIC, qt_kardex NUMERIC, usuarioid NUMERIC, dt_kardex TIMESTAMP, tipo_kerdex TEXT, Qt_estoque_total_kardex NUMERIC)
        ) k1
        WHERE NOT EXISTS (
          SELECT 1 FROM entrada_producao_saidas_log
          WHERE kardexid_saida = k1.kardexid::INT
        )
        AND EXISTS (
          SELECT 1
          FROM entrada_producao ep
          WHERE ep.kardexid = (
            SELECT ep2.kardexid
            FROM entrada_producao ep2
            WHERE ep2.produtoid = k1.produtoid::INT
              AND ep2.usuario_origem = k1.usuarioid::INT
              AND ep2.data_kardex < k1.dt_kardex
            ORDER BY ep2.data_kardex DESC, ep2.id DESC
            LIMIT 1
          )
        )
      LOOP
        BEGIN
          PERFORM processar_saida_kardex(
            v_saida.kardexid_entrada,
            v_saida.kardexid_saida,
            ABS(v_saida.quantidade_saida)::INT,
            v_saida.usuarioid,
            v_saida.dt_kardex
          );
          v_processadas := v_processadas + 1;
        EXCEPTION WHEN OTHERS THEN
          v_erros := v_erros + 1;
          RAISE NOTICE 'Erro ao processar saida kardex %: %', v_saida.kardexid_saida, SQLERRM;
        END;
      END LOOP;

      RETURN QUERY
      SELECT v_processadas::INT, v_erros::INT, 'Sincronizacao de saidas concluida'::VARCHAR;
    END;
    $$;


ALTER FUNCTION public.sincronizar_saidas_kardex() OWNER TO postgres;

--
-- TOC entry 575 (class 1255 OID 16356151)
-- Name: sync_estrutura_produtos_from_aworks(boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_estrutura_produtos_from_aworks(p_full_refresh boolean DEFAULT false) RETURNS TABLE(processadas integer, inseridas integer, atualizadas integer)
    LANGUAGE plpgsql
    AS $_$
DECLARE
  conn text := current_setting('app.aworks_dblink_conn', true);
  v_col_id_estrutura text;
  v_col_id_produto text;
  v_col_id_componente text;
  v_col_quantidade text;
  v_col_unidade text;
  v_col_perda text;
  v_col_ativo text;
  v_remote_sql text;
  v_processadas integer := 0;
  v_inseridas integer := 0;
  v_atualizadas integer := 0;
  v_fk_produto_count integer := 0;
BEGIN
  IF conn IS NULL OR btrim(conn) = '' THEN
    RAISE EXCEPTION 'Parametro app.aworks_dblink_conn nao configurado';
  END IF;

  -- Garantir reexecucao segura na mesma sessao (inclusive apos erro anterior)
  DROP TABLE IF EXISTS pg_temp.tmp_cols_estrutura_aworks;
  DROP TABLE IF EXISTS pg_temp.tmp_fk_estrutura_produto;
  DROP TABLE IF EXISTS pg_temp.tmp_estrutura_aworks;

  -- Verifica se tabela estrutura existe no AWORKS
  IF NOT EXISTS (
    SELECT 1
    FROM dblink(
      conn,
      $aw$
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'estrutura'
      LIMIT 1
      $aw$
    ) AS t(existe integer)
  ) THEN
    RAISE EXCEPTION 'Tabela public.estrutura nao encontrada no AWORKS';
  END IF;

  CREATE TEMP TABLE tmp_cols_estrutura_aworks (
    column_name text
    ,data_type text
    ,ordinal_position integer
  ) ON COMMIT DROP;

  INSERT INTO tmp_cols_estrutura_aworks(column_name, data_type, ordinal_position)
  SELECT column_name, data_type, ordinal_position
  FROM dblink(
    conn,
    $aw$
    SELECT column_name, data_type, ordinal_position
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'estrutura'
    ORDER BY ordinal_position
    $aw$
  ) AS t(column_name text, data_type text, ordinal_position integer);

  SELECT c.column_name INTO v_col_id_estrutura
  FROM tmp_cols_estrutura_aworks c
  WHERE c.column_name IN ('estruturaid', 'id_estrutura', 'id')
  ORDER BY CASE c.column_name
    WHEN 'estruturaid' THEN 1
    WHEN 'id_estrutura' THEN 2
    ELSE 3
  END
  LIMIT 1;

  SELECT c.column_name INTO v_col_id_produto
  FROM tmp_cols_estrutura_aworks c
  WHERE c.column_name IN ('produtoid_pai', 'id_produto_pai', 'produtoid', 'id_produto', 'produto_id')
  ORDER BY CASE c.column_name
    WHEN 'produtoid_pai' THEN 1
    WHEN 'id_produto_pai' THEN 2
    WHEN 'produtoid' THEN 3
    WHEN 'id_produto' THEN 4
    ELSE 5
  END
  LIMIT 1;

  SELECT c.column_name INTO v_col_id_componente
  FROM tmp_cols_estrutura_aworks c
  WHERE c.column_name IN (
    'produtoid_filho',
    'id_produto_filho',
    'produtoestruturaid',
    'id_produto_estrutura',
    'componenteid',
    'id_componente',
    'materiaprimaid'
  )
  ORDER BY CASE c.column_name
    WHEN 'produtoid_filho' THEN 1
    WHEN 'id_produto_filho' THEN 2
    WHEN 'produtoestruturaid' THEN 3
    WHEN 'id_produto_estrutura' THEN 4
    WHEN 'componenteid' THEN 5
    WHEN 'id_componente' THEN 6
    ELSE 7
  END
  LIMIT 1;

  -- Fallback 1: descobrir colunas que referenciam public.produto via FK no AWORKS
  IF v_col_id_produto IS NULL OR v_col_id_componente IS NULL THEN
    CREATE TEMP TABLE tmp_fk_estrutura_produto (
      column_name text,
      ordinal_position integer
    ) ON COMMIT DROP;

    INSERT INTO tmp_fk_estrutura_produto(column_name, ordinal_position)
    SELECT fk_column_name, ordinal_position
    FROM dblink(
      conn,
      $aw$
      SELECT
        kcu.column_name AS fk_column_name,
        cols.ordinal_position
      FROM information_schema.table_constraints tc
      INNER JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
      INNER JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      INNER JOIN information_schema.columns cols
        ON cols.table_schema = kcu.table_schema
       AND cols.table_name = kcu.table_name
       AND cols.column_name = kcu.column_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND kcu.table_schema = 'public'
        AND kcu.table_name = 'estrutura'
        AND ccu.table_schema = 'public'
        AND ccu.table_name = 'produto'
      ORDER BY cols.ordinal_position
      $aw$
    ) AS t(fk_column_name text, ordinal_position integer);

    SELECT COUNT(*) INTO v_fk_produto_count FROM tmp_fk_estrutura_produto;

    IF v_col_id_produto IS NULL THEN
      SELECT column_name
      INTO v_col_id_produto
      FROM tmp_fk_estrutura_produto
      ORDER BY ordinal_position
      LIMIT 1;
    END IF;

    IF v_col_id_componente IS NULL THEN
      SELECT column_name
      INTO v_col_id_componente
      FROM tmp_fk_estrutura_produto
      WHERE column_name <> COALESCE(v_col_id_produto, '')
      ORDER BY ordinal_position
      LIMIT 1;
    END IF;
  END IF;

  -- Fallback 2: heuristica por tipo/nome para id_produto
  IF v_col_id_produto IS NULL THEN
    SELECT c.column_name
    INTO v_col_id_produto
    FROM tmp_cols_estrutura_aworks c
    WHERE c.column_name <> COALESCE(v_col_id_estrutura, '')
      AND c.data_type IN ('integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision')
      AND (
        c.column_name ILIKE '%prod%'
        OR c.column_name ILIKE '%item%'
        OR c.column_name ILIKE '%pai%'
      )
    ORDER BY c.ordinal_position
    LIMIT 1;
  END IF;

  -- Fallback 3: heuristica por tipo/nome para id_componente
  IF v_col_id_componente IS NULL THEN
    SELECT c.column_name
    INTO v_col_id_componente
    FROM tmp_cols_estrutura_aworks c
    WHERE c.column_name NOT IN (COALESCE(v_col_id_estrutura, ''), COALESCE(v_col_id_produto, ''))
      AND c.data_type IN ('integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision')
      AND (
        c.column_name ILIKE '%comp%'
        OR c.column_name ILIKE '%materia%'
        OR c.column_name ILIKE '%insumo%'
        OR c.column_name ILIKE '%filho%'
        OR c.column_name ILIKE '%estrutura%'
      )
    ORDER BY c.ordinal_position
    LIMIT 1;
  END IF;

  -- Fallback 4: se ainda faltar componente, pega o proximo candidato numerico
  IF v_col_id_componente IS NULL THEN
    SELECT c.column_name
    INTO v_col_id_componente
    FROM tmp_cols_estrutura_aworks c
    WHERE c.column_name NOT IN (COALESCE(v_col_id_estrutura, ''), COALESCE(v_col_id_produto, ''))
      AND c.data_type IN ('integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision')
    ORDER BY c.ordinal_position
    LIMIT 1;
  END IF;

  SELECT c.column_name INTO v_col_quantidade
  FROM tmp_cols_estrutura_aworks c
  WHERE c.column_name IN ('qtde_estrutura', 'quantidade', 'qtde', 'qt_estrutura', 'quantidade_estrutura')
  ORDER BY CASE c.column_name
    WHEN 'qtde_estrutura' THEN 1
    WHEN 'quantidade' THEN 2
    WHEN 'qtde' THEN 3
    WHEN 'qt_estrutura' THEN 4
    ELSE 5
  END
  LIMIT 1;

  -- Fallback quantidade: primeiro campo numerico que nao seja ids
  IF v_col_quantidade IS NULL THEN
    SELECT c.column_name
    INTO v_col_quantidade
    FROM tmp_cols_estrutura_aworks c
    WHERE c.column_name NOT IN (
      COALESCE(v_col_id_estrutura, ''),
      COALESCE(v_col_id_produto, ''),
      COALESCE(v_col_id_componente, '')
    )
      AND c.data_type IN ('numeric', 'decimal', 'real', 'double precision', 'integer', 'bigint', 'smallint')
    ORDER BY c.ordinal_position
    LIMIT 1;
  END IF;

  SELECT c.column_name INTO v_col_unidade
  FROM tmp_cols_estrutura_aworks c
  WHERE c.column_name IN ('unidade', 'sigla_unidade', 'id_unidade', 'unidadeid')
  ORDER BY CASE c.column_name
    WHEN 'unidade' THEN 1
    WHEN 'sigla_unidade' THEN 2
    WHEN 'id_unidade' THEN 3
    ELSE 4
  END
  LIMIT 1;

  SELECT c.column_name INTO v_col_perda
  FROM tmp_cols_estrutura_aworks c
  WHERE c.column_name IN ('qt_perda_estrutura', 'perda_percentual', 'perc_perda', 'perda', 'percentual_perda')
  ORDER BY CASE c.column_name
    WHEN 'qt_perda_estrutura' THEN 1
    WHEN 'perda_percentual' THEN 2
    WHEN 'perc_perda' THEN 3
    WHEN 'perda' THEN 4
    ELSE 5
  END
  LIMIT 1;

  SELECT c.column_name INTO v_col_ativo
  FROM tmp_cols_estrutura_aworks c
  WHERE c.column_name IN ('ativo', 'status', 'status_estrutura')
  ORDER BY CASE c.column_name
    WHEN 'ativo' THEN 1
    WHEN 'status' THEN 2
    ELSE 3
  END
  LIMIT 1;

  IF v_col_id_estrutura IS NULL OR v_col_id_produto IS NULL OR v_col_id_componente IS NULL OR v_col_quantidade IS NULL THEN
    RAISE EXCEPTION
      'Nao foi possivel identificar colunas obrigatorias em AWORKS.public.estrutura (id_estrutura=%, id_produto=%, id_componente=%, quantidade=%). FKs produto detectadas=%',
      v_col_id_estrutura,
      v_col_id_produto,
      v_col_id_componente,
      v_col_quantidade,
      v_fk_produto_count;
  END IF;

  IF p_full_refresh THEN
    DELETE FROM public.estrutura_produtos WHERE origem = 'AWORKS';
  END IF;

  v_remote_sql := format(
    'SELECT %1$I::bigint AS id_estrutura_aworks,
            %2$I::integer AS id_produto_cache,
            %3$I::integer AS id_componente_cache,
            COALESCE(%4$I, 0)::numeric(18,6) AS quantidade,
            %5$s AS unidade,
            %6$s AS perda_percentual,
            %7$s AS ativo
     FROM public.estrutura',
    v_col_id_estrutura,
    v_col_id_produto,
    v_col_id_componente,
    v_col_quantidade,
    CASE
      WHEN v_col_unidade IS NULL THEN 'NULL::text'
      ELSE format('%I::text', v_col_unidade)
    END,
    CASE
      WHEN v_col_perda IS NULL THEN 'NULL::numeric(10,4)'
      ELSE format('NULLIF(%I::text, '''')::numeric(10,4)', v_col_perda)
    END,
    CASE
      WHEN v_col_ativo IS NULL THEN 'true'
      ELSE format(
        'CASE WHEN %1$I::text ILIKE ''INAT%%'' OR %1$I::text IN (''0'', ''F'', ''FALSE'', ''N'', ''NAO'') THEN false ELSE true END',
        v_col_ativo
      )
    END
  );

  CREATE TEMP TABLE tmp_estrutura_aworks ON COMMIT DROP AS
  SELECT
    e.id_estrutura_aworks,
    e.id_produto_cache,
    p_prod.id AS id_produto_local,
    e.id_componente_cache,
    p_comp.id AS id_componente_local,
    e.quantidade,
    e.unidade,
    e.perda_percentual,
    e.ativo
  FROM dblink(
    conn,
    v_remote_sql
  ) AS e(
    id_estrutura_aworks bigint,
    id_produto_cache integer,
    id_componente_cache integer,
    quantidade numeric(18,6),
    unidade text,
    perda_percentual numeric(10,4),
    ativo boolean
  )
  LEFT JOIN public.produtos p_prod
    ON p_prod.id_cache = e.id_produto_cache
  LEFT JOIN public.produtos p_comp
    ON p_comp.id_cache = e.id_componente_cache;

  SELECT COUNT(*) INTO v_processadas FROM tmp_estrutura_aworks;

  -- Atualiza existentes usando origem deduplicada por chave unica
  WITH src_unica AS (
    SELECT DISTINCT ON (
      src.id_estrutura_aworks,
      src.id_produto_cache,
      src.id_componente_cache
    )
      src.id_estrutura_aworks,
      src.id_produto_cache,
      src.id_produto_local,
      src.id_componente_cache,
      src.id_componente_local,
      src.quantidade,
      src.unidade,
      src.perda_percentual,
      src.ativo
    FROM tmp_estrutura_aworks src
    ORDER BY
      src.id_estrutura_aworks,
      src.id_produto_cache,
      src.id_componente_cache,
      src.ativo DESC,
      src.quantidade DESC,
      COALESCE(src.perda_percentual, 0) DESC
  )
  UPDATE public.estrutura_produtos dst
  SET
    id_produto_local = src.id_produto_local,
    id_componente_local = src.id_componente_local,
    quantidade = src.quantidade,
    unidade = src.unidade,
    perda_percentual = src.perda_percentual,
    ativo = src.ativo,
    origem = 'AWORKS',
    updated_at = NOW()
  FROM src_unica src
  WHERE dst.id_estrutura_aworks = src.id_estrutura_aworks
    AND dst.id_produto_cache = src.id_produto_cache
    AND dst.id_componente_cache = src.id_componente_cache;

  GET DIAGNOSTICS v_atualizadas = ROW_COUNT;

  -- Insere novas com deduplicacao e upsert defensivo
  WITH src_unica AS (
    SELECT DISTINCT ON (
      src.id_estrutura_aworks,
      src.id_produto_cache,
      src.id_componente_cache
    )
      src.id_estrutura_aworks,
      src.id_produto_cache,
      src.id_produto_local,
      src.id_componente_cache,
      src.id_componente_local,
      src.quantidade,
      src.unidade,
      src.perda_percentual,
      src.ativo
    FROM tmp_estrutura_aworks src
    ORDER BY
      src.id_estrutura_aworks,
      src.id_produto_cache,
      src.id_componente_cache,
      src.ativo DESC,
      src.quantidade DESC,
      COALESCE(src.perda_percentual, 0) DESC
  )
  INSERT INTO public.estrutura_produtos (
    id_estrutura_aworks,
    id_produto_cache,
    id_produto_local,
    id_componente_cache,
    id_componente_local,
    quantidade,
    unidade,
    perda_percentual,
    ativo,
    origem,
    created_at,
    updated_at
  )
  SELECT
    src.id_estrutura_aworks,
    src.id_produto_cache,
    src.id_produto_local,
    src.id_componente_cache,
    src.id_componente_local,
    src.quantidade,
    src.unidade,
    src.perda_percentual,
    src.ativo,
    'AWORKS',
    NOW(),
    NOW()
  FROM src_unica src
  ON CONFLICT (id_estrutura_aworks, id_produto_cache, id_componente_cache)
  DO UPDATE SET
    id_produto_local = EXCLUDED.id_produto_local,
    id_componente_local = EXCLUDED.id_componente_local,
    quantidade = EXCLUDED.quantidade,
    unidade = EXCLUDED.unidade,
    perda_percentual = EXCLUDED.perda_percentual,
    ativo = EXCLUDED.ativo,
    origem = 'AWORKS',
    updated_at = NOW();

  GET DIAGNOSTICS v_inseridas = ROW_COUNT;

  processadas := v_processadas;
  inseridas := v_inseridas;
  atualizadas := v_atualizadas;
  RETURN NEXT;
END;
$_$;


ALTER FUNCTION public.sync_estrutura_produtos_from_aworks(p_full_refresh boolean) OWNER TO postgres;

--
-- TOC entry 569 (class 1255 OID 78906)
-- Name: sync_produto_by_referencia(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_produto_by_referencia() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Verifica se a referência existe na tabela produtos
    IF NOT EXISTS (SELECT 1 FROM produtos WHERE referencia_produto = NEW.referencia) THEN
        -- Insere o produto faltante na tabela produtos (com tp_produto, ean13 e peso bruto)
        INSERT INTO produtos (referencia_produto, ds_produto, id_cache, tp_produto, ean13, vl_pesobruto_produto)
        VALUES (
            NEW.referencia,
            NEW.descricao,
            NEW.id,
            NEW.tp_produto,
            NEW.ean13,
            NEW.vl_pesobruto_produto
        )
        ON CONFLICT (referencia_produto) DO UPDATE
        SET ds_produto = NEW.descricao,
            id_cache = NEW.id,
            tp_produto = NEW.tp_produto,
            ean13 = NEW.ean13,
            vl_pesobruto_produto = NEW.vl_pesobruto_produto;
        
        -- Atualiza o mapeamento
        INSERT INTO produto_id_mapping (id_original, id_cache, referencia_produto, ativo)
        SELECT p.id, NEW.id, NEW.referencia, true
        FROM produtos p
        WHERE p.referencia_produto = NEW.referencia
        ON CONFLICT (id_original, id_cache) DO UPDATE
        SET ativo = true,
            referencia_produto = NEW.referencia;
    ELSE
                -- Se o produto já existe, atualiza tp_produto, ean13 e peso bruto se necessário
        UPDATE produtos
                SET tp_produto = NEW.tp_produto,
                    ean13 = NEW.ean13,
                    vl_pesobruto_produto = NEW.vl_pesobruto_produto
        WHERE referencia_produto = NEW.referencia
                    AND (
                                tp_produto IS DISTINCT FROM NEW.tp_produto
                     OR ean13 IS DISTINCT FROM NEW.ean13
                     OR vl_pesobruto_produto IS DISTINCT FROM NEW.vl_pesobruto_produto
                    );
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.sync_produto_by_referencia() OWNER TO postgres;

--
-- TOC entry 572 (class 1255 OID 78908)
-- Name: sync_produtos_from_cache(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_produtos_from_cache() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    contador INTEGER := 0;
    linhas_afetadas INTEGER;
BEGIN
    -- Atualiza produtos existentes (incluindo tp_produto, ean13 e peso bruto)
    UPDATE produtos p
    SET 
        ds_produto = pc.descricao,
        id_cache = pc.id,
        tp_produto = pc.tp_produto,
        ean13 = pc.ean13,
        vl_pesobruto_produto = pc.vl_pesobruto_produto
    FROM produtos_cache pc
    WHERE p.referencia_produto = pc.referencia;
    
    GET DIAGNOSTICS linhas_afetadas = ROW_COUNT;
    contador := contador + linhas_afetadas;
    
    -- Insere novos produtos faltantes (com tp_produto, ean13 e peso bruto)
    INSERT INTO produtos (referencia_produto, ds_produto, id_cache, tp_produto, ean13, vl_pesobruto_produto)
    SELECT 
        pc.referencia,
        pc.descricao,
        pc.id,
        pc.tp_produto,
        pc.ean13,
        pc.vl_pesobruto_produto
    FROM produtos_cache pc
    LEFT JOIN produtos p ON pc.referencia = p.referencia_produto
    WHERE p.id IS NULL;
    
    GET DIAGNOSTICS linhas_afetadas = ROW_COUNT;
    contador := contador + linhas_afetadas;
    
    -- Atualiza mapeamentos
    INSERT INTO produto_id_mapping (id_original, id_cache, referencia_produto, ativo)
    SELECT 
        p.id,
        p.id_cache,
        p.referencia_produto,
        true
    FROM produtos p
    LEFT JOIN produto_id_mapping m ON p.id = m.id_original AND m.id_cache = p.id_cache
    WHERE p.id_cache IS NOT NULL AND m.id IS NULL;
    
    GET DIAGNOSTICS linhas_afetadas = ROW_COUNT;
    contador := contador + linhas_afetadas;
    
    RETURN contador;
END;
$$;


ALTER FUNCTION public.sync_produtos_from_cache() OWNER TO postgres;

--
-- TOC entry 620 (class 1255 OID 16357214)
-- Name: sync_produtos_vinculo_estrutura_from_cache(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.sync_produtos_vinculo_estrutura_from_cache() RETURNS TABLE(processados integer, inseridos integer, atualizados integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_processados integer := 0;
  v_inseridos integer := 0;
  v_atualizados integer := 0;
BEGIN
  -- Atualiza produtos ja mapeados por id_cache com campos minimos
  UPDATE public.produtos p
  SET
    referencia_produto = pc.referencia,
    ds_produto = pc.descricao,
    ean13 = pc.ean13,
    updated_at = NOW()
  FROM public.produtos_cache pc
  WHERE p.id_cache = pc.id
    AND (
      p.referencia_produto IS DISTINCT FROM pc.referencia
      OR p.ds_produto IS DISTINCT FROM pc.descricao
      OR p.ean13 IS DISTINCT FROM pc.ean13
    );

  GET DIAGNOSTICS v_atualizados = ROW_COUNT;

  -- Vincula id_cache por referencia quando ainda nao estiver preenchido
  UPDATE public.produtos p
  SET
    id_cache = pc.id,
    ean13 = COALESCE(pc.ean13, p.ean13),
    updated_at = NOW()
  FROM public.produtos_cache pc
  WHERE p.id_cache IS NULL
    AND p.referencia_produto = pc.referencia;

  GET DIAGNOSTICS v_processados = ROW_COUNT;

  -- Insere apenas campos minimos para novos produtos
  INSERT INTO public.produtos (
    referencia_produto,
    ds_produto,
    id_cache,
    ean13,
    updated_at
  )
  SELECT
    pc.referencia,
    pc.descricao,
    pc.id,
    pc.ean13,
    NOW()
  FROM public.produtos_cache pc
  LEFT JOIN public.produtos p
    ON p.id_cache = pc.id
  WHERE p.id IS NULL;

  GET DIAGNOSTICS v_inseridos = ROW_COUNT;

  processados := v_processados;
  inseridos := v_inseridos;
  atualizados := v_atualizados;
  RETURN NEXT;
END;
$$;


ALTER FUNCTION public.sync_produtos_vinculo_estrutura_from_cache() OWNER TO postgres;

--
-- TOC entry 557 (class 1255 OID 74597)
-- Name: trigger_atualizar_cache(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trigger_atualizar_cache() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM public.atualizar_produtos_cache();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.trigger_atualizar_cache() OWNER TO postgres;

--
-- TOC entry 658 (class 1255 OID 3277399)
-- Name: trigger_sincronizar_pedido_novo(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.trigger_sincronizar_pedido_novo() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Verificar se o pedido tem itens pendentes
  IF EXISTS (
    SELECT 1 FROM vw_pedido_itens_aworks_simples 
    WHERE pedidovendaid = NEW.id 
      AND (quantidade_entrega - COALESCE(quantidade_despachada, 0)) > 0
  ) THEN
    -- Inserir na tabela de separação se ainda não existir
    INSERT INTO separacao_pedidos (pedidovendaid, nr_nota_fiscal, cliente_nome, status, observacoes)
    VALUES (
      NEW.id,
      NEW.nr_nota_pedidovenda,
      NEW.cliente_nome,
      'PENDENTE',
      'Pedido ' || NEW.prioridade || ' sincronizado automaticamente por trigger'
    )
    ON CONFLICT (pedidovendaid) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.trigger_sincronizar_pedido_novo() OWNER TO postgres;

--
-- TOC entry 638 (class 1255 OID 3846808)
-- Name: update_relatorios_falta_timestamp(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_relatorios_falta_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_relatorios_falta_timestamp() OWNER TO postgres;

--
-- TOC entry 625 (class 1255 OID 100076)
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

--
-- TOC entry 649 (class 1255 OID 74189)
-- Name: valida_atualizacao_maquina(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.valida_atualizacao_maquina() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.id_maquina IS DISTINCT FROM OLD.id_maquina THEN
        IF NEW.id_maquina IS NOT NULL THEN
            IF NOT EXISTS (
                SELECT 1 FROM maquinas 
                WHERE id = NEW.id_maquina AND tipo_maquina = 'INJETORA'
            ) THEN
                RAISE EXCEPTION 'A máquina associada ao molde deve ser do tipo INJETORA';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.valida_atualizacao_maquina() OWNER TO postgres;

--
-- TOC entry 629 (class 1255 OID 74157)
-- Name: valida_maquina_injetora(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.valida_maquina_injetora() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.id_maquina IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM maquinas 
            WHERE id = NEW.id_maquina AND tipo_maquina = 'INJETORA'
        ) THEN
            RAISE EXCEPTION 'A máquina associada ao molde deve ser do tipo INJETORA';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.valida_maquina_injetora() OWNER TO postgres;

--
-- TOC entry 619 (class 1255 OID 74302)
-- Name: validar_conflito_agendamento(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.validar_conflito_agendamento() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    conflito_exists BOOLEAN;
BEGIN
    -- Verificar se há conflito com outras atividades na mesma máquina
    SELECT EXISTS(
        SELECT 1 FROM public.planejamento_producao
        WHERE id_maquina = NEW.id_maquina
        AND id != NEW.id
        AND (
            (NEW.data_inicio BETWEEN data_inicio AND data_fim) OR
            (NEW.data_fim BETWEEN data_inicio AND data_fim) OR
            (data_inicio BETWEEN NEW.data_inicio AND NEW.data_fim) OR
            (data_fim BETWEEN NEW.data_inicio AND NEW.data_fim)
        )
        AND status NOT IN ('cancelado', 'concluido')
    ) INTO conflito_exists;
    
    IF conflito_exists THEN
        RAISE EXCEPTION 'Conflito de agendamento: a máquina já está ocupada neste período';
    END IF;
    
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.validar_conflito_agendamento() OWNER TO postgres;

--
-- TOC entry 666 (class 1255 OID 6208168)
-- Name: verificar_bloqueio_item(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.verificar_bloqueio_item(p_pedidovendaitemid integer) RETURNS TABLE(bloqueado boolean, bloqueado_por integer, nome_operador character varying, data_bloqueio timestamp without time zone)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        (si.bloqueado_por IS NOT NULL)::BOOLEAN,
        si.bloqueado_por,
        o.nome,
        si.data_bloqueio
    FROM public.separacao_itens si
    LEFT JOIN public.operadores o ON si.bloqueado_por = o.id
    WHERE si.pedidovendaitemid = p_pedidovendaitemid;
END;
$$;


ALTER FUNCTION public.verificar_bloqueio_item(p_pedidovendaitemid integer) OWNER TO postgres;

--
-- TOC entry 6449 (class 0 OID 0)
-- Dependencies: 666
-- Name: FUNCTION verificar_bloqueio_item(p_pedidovendaitemid integer); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION public.verificar_bloqueio_item(p_pedidovendaitemid integer) IS 'Verifica o status de bloqueio de um item para separação';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 514 (class 1259 OID 14395537)
-- Name: agenda_maquina; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.agenda_maquina (
    id bigint NOT NULL,
    id_carga_maquina bigint NOT NULL,
    id_maquina integer NOT NULL,
    data_inicio timestamp without time zone NOT NULL,
    data_fim timestamp without time zone NOT NULL,
    setup_minutos numeric(18,3) DEFAULT 0 NOT NULL,
    producao_minutos numeric(18,3) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.agenda_maquina OWNER TO postgres;

--
-- TOC entry 513 (class 1259 OID 14395536)
-- Name: agenda_maquina_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.agenda_maquina_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.agenda_maquina_id_seq OWNER TO postgres;

--
-- TOC entry 6452 (class 0 OID 0)
-- Dependencies: 513
-- Name: agenda_maquina_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.agenda_maquina_id_seq OWNED BY public.agenda_maquina.id;


--
-- TOC entry 361 (class 1259 OID 49468)
-- Name: apontamento_producao; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.apontamento_producao (
    id integer NOT NULL,
    id_operador integer NOT NULL,
    id_maquina integer NOT NULL,
    id_produto integer,
    data_inicio timestamp without time zone NOT NULL,
    data_fim timestamp without time zone,
    quantidade_pecas integer,
    status character varying(20) NOT NULL,
    pecas_boas integer,
    id_ordem_producao character varying(50),
    refugo_kg numeric,
    id_motivo_refugo integer,
    motivo_refugo_descricao character varying(100),
    motivo_refugo_tipo character varying(50),
    produto_cache_id integer,
    motivo_parada_maquina character varying(200),
    origem_automatica boolean DEFAULT false,
    device_id character varying(50),
    motivo_transferencia text,
    id_apontamento_origem integer,
    id_molde integer,
    id_molde_versao integer,
    cavidades_previstas integer,
    cavidades_ativas integer[] DEFAULT '{}'::integer[],
    cavidades_paradas integer[] DEFAULT '{}'::integer[],
    estado_injetora character varying(20) DEFAULT 'PARADA'::character varying,
    observacao_injetora text,
    CONSTRAINT apontamento_producao_estado_injetora_check CHECK (((estado_injetora)::text = ANY (ARRAY[('PARADA'::character varying)::text, ('SETUP'::character varying)::text, ('EM_ANDAMENTO'::character varying)::text, ('PAUSADO'::character varying)::text, ('FINALIZADO'::character varying)::text]))),
    CONSTRAINT apontamento_producao_status_check CHECK (((status)::text = ANY (ARRAY[('EM_ANDAMENTO'::character varying)::text, ('FINALIZADO'::character varying)::text, ('PAUSADO'::character varying)::text, ('MAQUINA_PARADA'::character varying)::text])))
);


ALTER TABLE public.apontamento_producao OWNER TO postgres;

--
-- TOC entry 360 (class 1259 OID 49467)
-- Name: apontamento_producao_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.apontamento_producao_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.apontamento_producao_id_seq OWNER TO postgres;

--
-- TOC entry 6454 (class 0 OID 0)
-- Dependencies: 360
-- Name: apontamento_producao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.apontamento_producao_id_seq OWNED BY public.apontamento_producao.id;


--
-- TOC entry 401 (class 1259 OID 74333)
-- Name: apontamento_pulsos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.apontamento_pulsos (
    id integer NOT NULL,
    id_maquina integer NOT NULL,
    pulsos integer NOT NULL,
    device_id character varying(50),
    "timestamp" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    id_apontamento integer,
    id_operador integer,
    quantidade_incrementada integer DEFAULT 0,
    cavidades_utilizadas integer DEFAULT 1,
    CONSTRAINT apontamento_pulsos_cavidades_utilizadas_check CHECK ((cavidades_utilizadas >= 1))
);


ALTER TABLE public.apontamento_pulsos OWNER TO postgres;

--
-- TOC entry 400 (class 1259 OID 74332)
-- Name: apontamento_pulsos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.apontamento_pulsos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.apontamento_pulsos_id_seq OWNER TO postgres;

--
-- TOC entry 6455 (class 0 OID 0)
-- Dependencies: 400
-- Name: apontamento_pulsos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.apontamento_pulsos_id_seq OWNED BY public.apontamento_pulsos.id;


--
-- TOC entry 512 (class 1259 OID 14395515)
-- Name: carga_maquina; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.carga_maquina (
    id bigint NOT NULL,
    id_ordem_producao character varying(50) NOT NULL,
    id_maquina integer NOT NULL,
    id_molde integer,
    id_operador integer,
    prioridade character varying(20) DEFAULT 'MEDIA'::character varying NOT NULL,
    status character varying(30) DEFAULT 'PLANEJADO'::character varying NOT NULL,
    quantidade numeric(18,3) DEFAULT 0 NOT NULL,
    tempo_ciclo_segundos numeric(18,4) DEFAULT 0 NOT NULL,
    cavidades integer DEFAULT 1 NOT NULL,
    eficiencia_prevista numeric(10,4) DEFAULT 1 NOT NULL,
    tempo_setup_minutos numeric(18,3) DEFAULT 0 NOT NULL,
    tempo_producao_minutos numeric(18,3) DEFAULT 0 NOT NULL,
    data_inicio timestamp without time zone NOT NULL,
    data_fim timestamp without time zone NOT NULL,
    observacoes text,
    criado_por integer,
    atualizado_por integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.carga_maquina OWNER TO postgres;

--
-- TOC entry 520 (class 1259 OID 14395579)
-- Name: carga_maquina_auditoria; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.carga_maquina_auditoria (
    id bigint NOT NULL,
    id_carga_maquina bigint,
    usuario_id integer,
    acao character varying(30) NOT NULL,
    programacao_anterior jsonb,
    programacao_nova jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.carga_maquina_auditoria OWNER TO postgres;

--
-- TOC entry 519 (class 1259 OID 14395578)
-- Name: carga_maquina_auditoria_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.carga_maquina_auditoria_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.carga_maquina_auditoria_id_seq OWNER TO postgres;

--
-- TOC entry 6458 (class 0 OID 0)
-- Dependencies: 519
-- Name: carga_maquina_auditoria_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.carga_maquina_auditoria_id_seq OWNED BY public.carga_maquina_auditoria.id;


--
-- TOC entry 511 (class 1259 OID 14395514)
-- Name: carga_maquina_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.carga_maquina_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.carga_maquina_id_seq OWNER TO postgres;

--
-- TOC entry 6460 (class 0 OID 0)
-- Dependencies: 511
-- Name: carga_maquina_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.carga_maquina_id_seq OWNED BY public.carga_maquina.id;


--
-- TOC entry 467 (class 1259 OID 191463)
-- Name: chat_mensagens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_mensagens (
    id integer NOT NULL,
    sala_id integer,
    operador_id integer,
    mensagem text,
    tipo character varying(20) DEFAULT 'texto'::character varying,
    arquivo_nome character varying(255),
    arquivo_url character varying(500),
    data_envio timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    lida boolean DEFAULT false
);


ALTER TABLE public.chat_mensagens OWNER TO postgres;

--
-- TOC entry 466 (class 1259 OID 191462)
-- Name: chat_mensagens_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.chat_mensagens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chat_mensagens_id_seq OWNER TO postgres;

--
-- TOC entry 6462 (class 0 OID 0)
-- Dependencies: 466
-- Name: chat_mensagens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.chat_mensagens_id_seq OWNED BY public.chat_mensagens.id;


--
-- TOC entry 469 (class 1259 OID 191485)
-- Name: chat_notificacoes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_notificacoes (
    id integer NOT NULL,
    operador_id integer,
    sala_id integer,
    mensagem_id integer,
    lida boolean DEFAULT false,
    data_notificacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.chat_notificacoes OWNER TO postgres;

--
-- TOC entry 468 (class 1259 OID 191484)
-- Name: chat_notificacoes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.chat_notificacoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chat_notificacoes_id_seq OWNER TO postgres;

--
-- TOC entry 6463 (class 0 OID 0)
-- Dependencies: 468
-- Name: chat_notificacoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.chat_notificacoes_id_seq OWNED BY public.chat_notificacoes.id;


--
-- TOC entry 465 (class 1259 OID 191444)
-- Name: chat_participantes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_participantes (
    id integer NOT NULL,
    sala_id integer,
    operador_id integer,
    data_entrada timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    ativo boolean DEFAULT true
);


ALTER TABLE public.chat_participantes OWNER TO postgres;

--
-- TOC entry 464 (class 1259 OID 191443)
-- Name: chat_participantes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.chat_participantes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chat_participantes_id_seq OWNER TO postgres;

--
-- TOC entry 6464 (class 0 OID 0)
-- Dependencies: 464
-- Name: chat_participantes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.chat_participantes_id_seq OWNED BY public.chat_participantes.id;


--
-- TOC entry 463 (class 1259 OID 191430)
-- Name: chat_salas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.chat_salas (
    id integer NOT NULL,
    nome character varying(255),
    tipo character varying(20) DEFAULT 'individual'::character varying,
    data_criacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    criador_id integer
);


ALTER TABLE public.chat_salas OWNER TO postgres;

--
-- TOC entry 462 (class 1259 OID 191429)
-- Name: chat_salas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.chat_salas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chat_salas_id_seq OWNER TO postgres;

--
-- TOC entry 6465 (class 0 OID 0)
-- Dependencies: 462
-- Name: chat_salas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.chat_salas_id_seq OWNED BY public.chat_salas.id;


--
-- TOC entry 427 (class 1259 OID 75016)
-- Name: checklist_execucoes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.checklist_execucoes (
    id integer NOT NULL,
    maquina_id integer,
    modelo_id integer,
    operador_id integer,
    data_hora timestamp without time zone DEFAULT now(),
    lote character varying(50),
    status character varying(20),
    produto_id integer,
    usuario_id integer,
    data_finalizacao date
);


ALTER TABLE public.checklist_execucoes OWNER TO postgres;

--
-- TOC entry 426 (class 1259 OID 75015)
-- Name: checklist_execucoes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.checklist_execucoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.checklist_execucoes_id_seq OWNER TO postgres;

--
-- TOC entry 6466 (class 0 OID 0)
-- Dependencies: 426
-- Name: checklist_execucoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.checklist_execucoes_id_seq OWNED BY public.checklist_execucoes.id;


--
-- TOC entry 436 (class 1259 OID 78747)
-- Name: checklist_fotos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.checklist_fotos (
    id integer NOT NULL,
    checklist_id integer NOT NULL,
    caminho text NOT NULL,
    descricao text,
    data_hora timestamp without time zone DEFAULT now(),
    item_id integer
);


ALTER TABLE public.checklist_fotos OWNER TO postgres;

--
-- TOC entry 435 (class 1259 OID 78746)
-- Name: checklist_fotos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.checklist_fotos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.checklist_fotos_id_seq OWNER TO postgres;

--
-- TOC entry 6467 (class 0 OID 0)
-- Dependencies: 435
-- Name: checklist_fotos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.checklist_fotos_id_seq OWNED BY public.checklist_fotos.id;


--
-- TOC entry 433 (class 1259 OID 75077)
-- Name: checklist_itens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.checklist_itens (
    id integer NOT NULL,
    modelo_id integer,
    descricao text NOT NULL,
    tipo character varying(20) NOT NULL,
    instrucao text,
    parametro text,
    instrumento text,
    unidade text,
    valor_ideal text,
    codigo_defeito text,
    ordem integer DEFAULT 0 NOT NULL,
    CONSTRAINT checklist_itens_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['PARAMETRO'::character varying, 'OPCAO'::character varying, 'DEFEITO'::character varying, 'NAO_CONFORMIDADE'::character varying])::text[])))
);


ALTER TABLE public.checklist_itens OWNER TO postgres;

--
-- TOC entry 432 (class 1259 OID 75076)
-- Name: checklist_itens_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.checklist_itens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.checklist_itens_id_seq OWNER TO postgres;

--
-- TOC entry 6468 (class 0 OID 0)
-- Dependencies: 432
-- Name: checklist_itens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.checklist_itens_id_seq OWNED BY public.checklist_itens.id;


--
-- TOC entry 431 (class 1259 OID 75067)
-- Name: checklist_modelos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.checklist_modelos (
    id integer NOT NULL,
    nome character varying(100) NOT NULL,
    tipo_processo character varying(20) NOT NULL,
    ativo boolean DEFAULT true,
    data_criacao timestamp without time zone DEFAULT now(),
    CONSTRAINT checklist_modelos_tipo_processo_check CHECK (((tipo_processo)::text = ANY ((ARRAY['INJECAO'::character varying, 'MONTAGEM'::character varying, 'EMBALAGEM'::character varying])::text[])))
);


ALTER TABLE public.checklist_modelos OWNER TO postgres;

--
-- TOC entry 430 (class 1259 OID 75066)
-- Name: checklist_modelos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.checklist_modelos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.checklist_modelos_id_seq OWNER TO postgres;

--
-- TOC entry 6469 (class 0 OID 0)
-- Dependencies: 430
-- Name: checklist_modelos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.checklist_modelos_id_seq OWNED BY public.checklist_modelos.id;


--
-- TOC entry 429 (class 1259 OID 75039)
-- Name: checklist_respostas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.checklist_respostas (
    id integer NOT NULL,
    execucao_id integer,
    item_id integer,
    conformidade boolean,
    observacao text,
    nao_conformidade_id integer,
    acao_corretiva text,
    defeito_id integer,
    maquina_id integer,
    tipo_resposta character varying(20),
    valor_resposta text,
    valor_numerico numeric(10,2),
    cavidades_paradas integer,
    tempo_ciclo numeric(10,2)
);


ALTER TABLE public.checklist_respostas OWNER TO postgres;

--
-- TOC entry 428 (class 1259 OID 75038)
-- Name: checklist_respostas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.checklist_respostas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.checklist_respostas_id_seq OWNER TO postgres;

--
-- TOC entry 6470 (class 0 OID 0)
-- Dependencies: 428
-- Name: checklist_respostas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.checklist_respostas_id_seq OWNED BY public.checklist_respostas.id;


--
-- TOC entry 404 (class 1259 OID 74367)
-- Name: consultas_ia; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.consultas_ia (
    id integer NOT NULL,
    id_operador integer NOT NULL,
    pergunta text NOT NULL,
    resposta text,
    data_consulta timestamp without time zone DEFAULT now() NOT NULL,
    foi_util boolean,
    erro text
);


ALTER TABLE public.consultas_ia OWNER TO postgres;

--
-- TOC entry 403 (class 1259 OID 74366)
-- Name: consultas_ia_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.consultas_ia_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.consultas_ia_id_seq OWNER TO postgres;

--
-- TOC entry 6471 (class 0 OID 0)
-- Dependencies: 403
-- Name: consultas_ia_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.consultas_ia_id_seq OWNED BY public.consultas_ia.id;


--
-- TOC entry 416 (class 1259 OID 74512)
-- Name: contagem_estoque; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.contagem_estoque (
    id integer NOT NULL,
    id_produto integer NOT NULL,
    id_posicao integer NOT NULL,
    quantidade_pacotes numeric(15,6) NOT NULL,
    id_operador integer NOT NULL,
    data_contagem timestamp without time zone DEFAULT now() NOT NULL,
    contagem_finalizada boolean DEFAULT false,
    id_inventario integer NOT NULL,
    data_hora timestamp without time zone DEFAULT now(),
    lote character varying(50),
    observacao text,
    local_estoque character varying(20) DEFAULT 'expedicao'::character varying,
    id_local_estoque integer NOT NULL,
    quantidade_consumo numeric(12,4),
    id_unidade_consumo integer,
    CONSTRAINT contagem_estoque_local_estoque_check CHECK (((local_estoque)::text = ANY ((ARRAY['almoxarifado'::character varying, 'expedicao'::character varying])::text[])))
);


ALTER TABLE public.contagem_estoque OWNER TO postgres;

--
-- TOC entry 415 (class 1259 OID 74511)
-- Name: contagem_estoque_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.contagem_estoque_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.contagem_estoque_id_seq OWNER TO postgres;

--
-- TOC entry 6472 (class 0 OID 0)
-- Dependencies: 415
-- Name: contagem_estoque_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.contagem_estoque_id_seq OWNED BY public.contagem_estoque.id;


--
-- TOC entry 500 (class 1259 OID 8018004)
-- Name: controle_entrada_producao; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.controle_entrada_producao (
    chave character varying(100) NOT NULL,
    valor_timestamp timestamp without time zone,
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.controle_entrada_producao OWNER TO postgres;

--
-- TOC entry 421 (class 1259 OID 74947)
-- Name: defeitos_injecao; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.defeitos_injecao (
    id integer NOT NULL,
    codigo character varying(10) NOT NULL,
    descricao character varying(100) NOT NULL,
    categoria character varying(50) NOT NULL,
    gravidade integer,
    causa_provavel text,
    CONSTRAINT defeitos_injecao_gravidade_check CHECK (((gravidade >= 1) AND (gravidade <= 3)))
);


ALTER TABLE public.defeitos_injecao OWNER TO postgres;

--
-- TOC entry 420 (class 1259 OID 74946)
-- Name: defeitos_injecao_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.defeitos_injecao_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.defeitos_injecao_id_seq OWNER TO postgres;

--
-- TOC entry 6474 (class 0 OID 0)
-- Dependencies: 420
-- Name: defeitos_injecao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.defeitos_injecao_id_seq OWNED BY public.defeitos_injecao.id;


--
-- TOC entry 545 (class 1259 OID 16713139)
-- Name: divergencias_estoque; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.divergencias_estoque (
    id bigint NOT NULL,
    pedidovendaid integer NOT NULL,
    nr_nota_fiscal character varying(50) NOT NULL,
    cliente_nome character varying(200),
    pedidovendaitemid integer NOT NULL,
    produto_descricao character varying(200),
    produto_referencia character varying(100),
    quantidade_solicitada numeric(15,4),
    quantidade_separada numeric(15,4),
    quantidade_despachada numeric(15,4),
    divergencia numeric(15,4),
    data_detecao timestamp without time zone DEFAULT now(),
    status character varying(20) DEFAULT 'PENDENTE'::character varying,
    data_resolucao timestamp without time zone,
    resolvido_por integer,
    observacoes text
);


ALTER TABLE public.divergencias_estoque OWNER TO postgres;

--
-- TOC entry 544 (class 1259 OID 16713138)
-- Name: divergencias_estoque_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.divergencias_estoque_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.divergencias_estoque_id_seq OWNER TO postgres;

--
-- TOC entry 6476 (class 0 OID 0)
-- Dependencies: 544
-- Name: divergencias_estoque_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.divergencias_estoque_id_seq OWNED BY public.divergencias_estoque.id;


--
-- TOC entry 406 (class 1259 OID 74399)
-- Name: enderecos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.enderecos (
    id integer NOT NULL,
    rua character varying(10) NOT NULL,
    modulo character varying(10) NOT NULL,
    nivel character varying(10) NOT NULL,
    posicao character varying(10) NOT NULL,
    status character varying(20) DEFAULT 'LIVRE'::character varying NOT NULL,
    id_produto integer,
    capacidade integer
);


ALTER TABLE public.enderecos OWNER TO postgres;

--
-- TOC entry 405 (class 1259 OID 74398)
-- Name: enderecos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.enderecos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.enderecos_id_seq OWNER TO postgres;

--
-- TOC entry 6478 (class 0 OID 0)
-- Dependencies: 405
-- Name: enderecos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.enderecos_id_seq OWNED BY public.enderecos.id;


--
-- TOC entry 486 (class 1259 OID 3943722)
-- Name: entrada_producao; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.entrada_producao (
    id integer NOT NULL,
    kardexid integer NOT NULL,
    produtoid integer NOT NULL,
    quantidade_total integer NOT NULL,
    quantidade_recebida integer DEFAULT 0,
    status character varying(50) DEFAULT 'PENDENTE'::character varying,
    usuario_origem integer,
    data_kardex timestamp without time zone,
    id_operador_recebimento integer,
    data_inicio_recebimento timestamp without time zone DEFAULT now(),
    data_finalizacao timestamp without time zone,
    observacoes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    quantidade_removida integer DEFAULT 0,
    status_remocao character varying(50) DEFAULT 'ATIVO'::character varying,
    foi_liberado_por_timeout boolean DEFAULT false
);


ALTER TABLE public.entrada_producao OWNER TO postgres;

--
-- TOC entry 485 (class 1259 OID 3943721)
-- Name: entrada_producao_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.entrada_producao_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.entrada_producao_id_seq OWNER TO postgres;

--
-- TOC entry 6480 (class 0 OID 0)
-- Dependencies: 485
-- Name: entrada_producao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.entrada_producao_id_seq OWNED BY public.entrada_producao.id;


--
-- TOC entry 488 (class 1259 OID 3943736)
-- Name: entrada_producao_itens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.entrada_producao_itens (
    id integer NOT NULL,
    id_entrada_producao integer NOT NULL,
    id_posicao integer NOT NULL,
    quantidade_colocada integer NOT NULL,
    id_operador_posicao integer,
    data_colocacao timestamp without time zone DEFAULT now(),
    observacoes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.entrada_producao_itens OWNER TO postgres;

--
-- TOC entry 487 (class 1259 OID 3943735)
-- Name: entrada_producao_itens_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.entrada_producao_itens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.entrada_producao_itens_id_seq OWNER TO postgres;

--
-- TOC entry 6483 (class 0 OID 0)
-- Dependencies: 487
-- Name: entrada_producao_itens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.entrada_producao_itens_id_seq OWNED BY public.entrada_producao_itens.id;


--
-- TOC entry 499 (class 1259 OID 6060463)
-- Name: entrada_producao_saidas_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.entrada_producao_saidas_log (
    id integer NOT NULL,
    kardexid_saida integer NOT NULL,
    kardexid_entrada_original integer,
    produtoid integer,
    quantidade_saida numeric,
    usuarioid integer,
    dt_saida timestamp without time zone,
    dt_processamento timestamp without time zone DEFAULT now(),
    operador_saida character varying(200),
    status character varying(50) DEFAULT 'PENDENTE'::character varying,
    observacoes text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.entrada_producao_saidas_log OWNER TO postgres;

--
-- TOC entry 498 (class 1259 OID 6060462)
-- Name: entrada_producao_saidas_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.entrada_producao_saidas_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.entrada_producao_saidas_log_id_seq OWNER TO postgres;

--
-- TOC entry 6486 (class 0 OID 0)
-- Dependencies: 498
-- Name: entrada_producao_saidas_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.entrada_producao_saidas_log_id_seq OWNED BY public.entrada_producao_saidas_log.id;


--
-- TOC entry 444 (class 1259 OID 78919)
-- Name: estoque; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.estoque (
    id integer NOT NULL,
    produto_id integer NOT NULL,
    posicao_id integer NOT NULL,
    quantidade numeric DEFAULT 0 NOT NULL,
    data_atualizacao timestamp without time zone DEFAULT now(),
    operador_id integer,
    id_local_estoque integer NOT NULL,
    quantidade_consumo numeric(12,4),
    id_unidade_consumo integer
);


ALTER TABLE public.estoque OWNER TO postgres;

--
-- TOC entry 506 (class 1259 OID 9967750)
-- Name: estoque_auditoria_eventos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.estoque_auditoria_eventos (
    id bigint NOT NULL,
    tabela_origem character varying(80) DEFAULT 'contagem_estoque'::character varying NOT NULL,
    operacao character varying(10) NOT NULL,
    id_registro bigint,
    id_produto integer,
    id_posicao integer,
    id_local_estoque integer,
    id_inventario integer,
    quantidade_anterior numeric(15,6),
    quantidade_atual numeric(15,6),
    delta_quantidade numeric(15,6),
    id_operador integer,
    origem_modulo character varying(80),
    origem_tipo character varying(80),
    referencia_movimento character varying(80),
    id_referencia bigint,
    observacao text,
    txid bigint DEFAULT txid_current() NOT NULL,
    data_evento timestamp without time zone DEFAULT now() NOT NULL,
    row_old jsonb,
    row_new jsonb,
    CONSTRAINT estoque_auditoria_eventos_operacao_check CHECK (((operacao)::text = ANY ((ARRAY['INSERT'::character varying, 'UPDATE'::character varying, 'DELETE'::character varying])::text[])))
);


ALTER TABLE public.estoque_auditoria_eventos OWNER TO postgres;

--
-- TOC entry 505 (class 1259 OID 9967749)
-- Name: estoque_auditoria_eventos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.estoque_auditoria_eventos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.estoque_auditoria_eventos_id_seq OWNER TO postgres;

--
-- TOC entry 6489 (class 0 OID 0)
-- Dependencies: 505
-- Name: estoque_auditoria_eventos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.estoque_auditoria_eventos_id_seq OWNED BY public.estoque_auditoria_eventos.id;


--
-- TOC entry 457 (class 1259 OID 125715)
-- Name: locais_estoque; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.locais_estoque (
    id integer NOT NULL,
    codigo character varying(20) NOT NULL,
    descricao character varying(100) NOT NULL,
    tipo character varying(20) DEFAULT 'fisico'::character varying,
    ativo boolean DEFAULT true,
    data_criacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT locais_estoque_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['fisico'::character varying, 'virtual'::character varying])::text[])))
);


ALTER TABLE public.locais_estoque OWNER TO postgres;

--
-- TOC entry 414 (class 1259 OID 74498)
-- Name: posicoes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.posicoes (
    id integer NOT NULL,
    id_nivel integer NOT NULL,
    codigo character varying(10) NOT NULL,
    descricao character varying(100),
    capacidade integer,
    codigo_barras character varying(20),
    local_estoque character varying(20) DEFAULT 'expedicao'::character varying,
    id_local_estoque integer NOT NULL,
    CONSTRAINT posicoes_local_estoque_check CHECK (((local_estoque)::text = ANY ((ARRAY['almoxarifado'::character varying, 'expedicao'::character varying])::text[])))
);


ALTER TABLE public.posicoes OWNER TO postgres;

--
-- TOC entry 359 (class 1259 OID 49442)
-- Name: produtos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.produtos (
    id integer NOT NULL,
    referencia_produto character varying(200) NOT NULL,
    ds_produto character varying(100) NOT NULL,
    ean13 text,
    id_original integer,
    id_cache integer,
    tempo_padrao_montagem_segundos numeric,
    tempo_padrao_embalagem_segundos numeric,
    tempo_padrao_injecao_segundos numeric,
    pecas_por_ciclo numeric DEFAULT 1,
    meta_horaria_montagem numeric,
    meta_horaria_embalagem numeric,
    meta_horaria_injecao numeric,
    updated_at timestamp without time zone DEFAULT now(),
    id_unidade_compra integer,
    id_unidade_consumo integer,
    fator_conversao_compra_consumo numeric(10,4) DEFAULT 1,
    tp_produto character varying(50),
    vl_pesobruto_produto numeric(15,6),
    subgrupoprodutoid numeric(8,0),
    grupoprodutoid numeric(8,0),
    lead_time_compra_dias integer DEFAULT 0,
    estoque_minimo numeric(15,6) DEFAULT 0,
    ponto_pedido numeric(15,6) DEFAULT 0,
    lote_compra numeric(15,6) DEFAULT 0,
    ativo boolean DEFAULT true
);


ALTER TABLE public.produtos OWNER TO postgres;

--
-- TOC entry 6491 (class 0 OID 0)
-- Dependencies: 359
-- Name: COLUMN produtos.tp_produto; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.produtos.tp_produto IS 'Tipo de produto importado do AWORKS (ACABADO, PRODUTO, etc)';


--
-- TOC entry 6492 (class 0 OID 0)
-- Dependencies: 359
-- Name: COLUMN produtos.vl_pesobruto_produto; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.produtos.vl_pesobruto_produto IS 'Peso bruto unitario do produto no AWORKS (kg)';


--
-- TOC entry 6493 (class 0 OID 0)
-- Dependencies: 359
-- Name: COLUMN produtos.subgrupoprodutoid; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.produtos.subgrupoprodutoid IS 'ID do subgrupo no AWORKS (subgrupoprodutoid)';


--
-- TOC entry 6494 (class 0 OID 0)
-- Dependencies: 359
-- Name: COLUMN produtos.grupoprodutoid; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.produtos.grupoprodutoid IS 'ID do grupo no AWORKS (grupoprodutoid)';


--
-- TOC entry 459 (class 1259 OID 153670)
-- Name: unidades; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.unidades (
    id integer NOT NULL,
    codigo character varying(20) NOT NULL,
    descricao character varying(100) NOT NULL,
    tipo character varying(20) NOT NULL,
    ativo boolean DEFAULT true,
    data_criacao timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unidades_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['entrada'::character varying, 'saída'::character varying, 'ambos'::character varying])::text[])))
);


ALTER TABLE public.unidades OWNER TO postgres;

--
-- TOC entry 492 (class 1259 OID 4508895)
-- Name: estoque_consolidado; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.estoque_consolidado AS
 SELECT e.id,
    e.produto_id,
    p.referencia_produto,
    p.ds_produto AS descricao_produto,
    e.posicao_id,
    po.codigo AS posicao_codigo,
    e.id_local_estoque,
    le.codigo AS local_estoque_codigo,
    le.descricao AS local_estoque_descricao,
    e.quantidade AS quantidade_original,
    COALESCE(e.quantidade_consumo, (e.quantidade * COALESCE(p.fator_conversao_compra_consumo, (1)::numeric))) AS quantidade_consumo,
    COALESCE(e.id_unidade_consumo, p.id_unidade_consumo, 1) AS id_unidade_consumo,
    p.id_unidade_compra,
    p.fator_conversao_compra_consumo,
    uc.codigo AS unidade_consumo_codigo,
    ue.codigo AS unidade_entrada_codigo,
    e.data_atualizacao,
    e.operador_id
   FROM (((((public.estoque e
     JOIN public.produtos p ON ((e.produto_id = p.id)))
     JOIN public.posicoes po ON ((e.posicao_id = po.id)))
     JOIN public.locais_estoque le ON ((e.id_local_estoque = le.id)))
     LEFT JOIN public.unidades uc ON ((COALESCE(e.id_unidade_consumo, p.id_unidade_consumo, 1) = uc.id)))
     LEFT JOIN public.unidades ue ON ((p.id_unidade_compra = ue.id)))
  WHERE (e.quantidade > (0)::numeric);


ALTER VIEW public.estoque_consolidado OWNER TO postgres;

--
-- TOC entry 443 (class 1259 OID 78918)
-- Name: estoque_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.estoque_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.estoque_id_seq OWNER TO postgres;

--
-- TOC entry 6496 (class 0 OID 0)
-- Dependencies: 443
-- Name: estoque_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.estoque_id_seq OWNED BY public.estoque.id;


--
-- TOC entry 502 (class 1259 OID 9402044)
-- Name: estoque_movimentacoes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.estoque_movimentacoes (
    id bigint NOT NULL,
    tipo_movimentacao character varying(20) NOT NULL,
    id_produto integer NOT NULL,
    id_posicao_origem integer,
    id_posicao_destino integer,
    quantidade numeric(18,3) NOT NULL,
    id_operador integer,
    modulo_origem character varying(80) DEFAULT 'SISTEMA'::character varying NOT NULL,
    referencia_movimento character varying(80),
    id_referencia bigint,
    observacao text,
    data_movimentacao timestamp without time zone DEFAULT now() NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    quantidade_anterior_origem numeric(18,3),
    quantidade_posterior_origem numeric(18,3),
    quantidade_anterior_destino numeric(18,3),
    quantidade_posterior_destino numeric(18,3),
    contexto jsonb
);


ALTER TABLE public.estoque_movimentacoes OWNER TO postgres;

--
-- TOC entry 501 (class 1259 OID 9402043)
-- Name: estoque_movimentacoes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.estoque_movimentacoes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.estoque_movimentacoes_id_seq OWNER TO postgres;

--
-- TOC entry 6498 (class 0 OID 0)
-- Dependencies: 501
-- Name: estoque_movimentacoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.estoque_movimentacoes_id_seq OWNED BY public.estoque_movimentacoes.id;


--
-- TOC entry 530 (class 1259 OID 16356122)
-- Name: estrutura_produtos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.estrutura_produtos (
    id bigint NOT NULL,
    id_estrutura_aworks bigint NOT NULL,
    id_produto_cache integer NOT NULL,
    id_produto_local integer,
    id_componente_cache integer NOT NULL,
    id_componente_local integer,
    quantidade numeric(18,6) DEFAULT 0 NOT NULL,
    unidade text,
    perda_percentual numeric(10,4),
    ativo boolean DEFAULT true NOT NULL,
    origem character varying(20) DEFAULT 'AWORKS'::character varying NOT NULL,
    observacao text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.estrutura_produtos OWNER TO postgres;

--
-- TOC entry 529 (class 1259 OID 16356121)
-- Name: estrutura_produtos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.estrutura_produtos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.estrutura_produtos_id_seq OWNER TO postgres;

--
-- TOC entry 6501 (class 0 OID 0)
-- Dependencies: 529
-- Name: estrutura_produtos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.estrutura_produtos_id_seq OWNED BY public.estrutura_produtos.id;


--
-- TOC entry 423 (class 1259 OID 74960)
-- Name: fatores_qualidade; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fatores_qualidade (
    id integer NOT NULL,
    fator character varying(100) NOT NULL,
    categoria character varying(50) NOT NULL
);


ALTER TABLE public.fatores_qualidade OWNER TO postgres;

--
-- TOC entry 422 (class 1259 OID 74959)
-- Name: fatores_qualidade_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fatores_qualidade_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.fatores_qualidade_id_seq OWNER TO postgres;

--
-- TOC entry 6503 (class 0 OID 0)
-- Dependencies: 422
-- Name: fatores_qualidade_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fatores_qualidade_id_seq OWNED BY public.fatores_qualidade.id;


--
-- TOC entry 525 (class 1259 OID 15493593)
-- Name: grupoproduto; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.grupoproduto (
    grupoprodutoid numeric(8,0) NOT NULL,
    nome_grupoproduto character varying(50) NOT NULL,
    filialid numeric(8,0) NOT NULL,
    empresaid numeric(8,0) NOT NULL,
    vl_meta_mensal_grupoproduto numeric(23,4) DEFAULT 0
);


ALTER TABLE public.grupoproduto OWNER TO postgres;

--
-- TOC entry 6504 (class 0 OID 0)
-- Dependencies: 525
-- Name: TABLE grupoproduto; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.grupoproduto IS 'Grupos de produtos importados do AWORKS (empresaid=1)';


--
-- TOC entry 395 (class 1259 OID 74277)
-- Name: historico_manutencoes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.historico_manutencoes (
    id integer NOT NULL,
    id_planejamento integer,
    id_tipo_manutencao integer,
    id_operador_responsavel integer,
    observacoes text,
    pecas_substituidas text,
    custo_estimado numeric(10,2),
    data_real_inicio timestamp without time zone,
    data_real_fim timestamp without time zone,
    status character varying(20) DEFAULT 'planejada'::character varying NOT NULL,
    checklist jsonb,
    CONSTRAINT check_status_manutencao CHECK (((status)::text = ANY ((ARRAY['planejada'::character varying, 'em_andamento'::character varying, 'concluida'::character varying, 'cancelada'::character varying])::text[])))
);


ALTER TABLE public.historico_manutencoes OWNER TO postgres;

--
-- TOC entry 394 (class 1259 OID 74276)
-- Name: historico_manutencoes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.historico_manutencoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.historico_manutencoes_id_seq OWNER TO postgres;

--
-- TOC entry 6506 (class 0 OID 0)
-- Dependencies: 394
-- Name: historico_manutencoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.historico_manutencoes_id_seq OWNED BY public.historico_manutencoes.id;


--
-- TOC entry 419 (class 1259 OID 74778)
-- Name: inventario; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventario (
    id integer NOT NULL,
    mes_referencia character varying(7) NOT NULL,
    data_abertura timestamp without time zone DEFAULT now(),
    data_fechamento timestamp without time zone,
    status character varying(20) DEFAULT 'aberto'::character varying,
    id_operador_abertura integer,
    id_operador_fechamento integer,
    CONSTRAINT inventario_status_check CHECK (((status)::text = ANY ((ARRAY['aberto'::character varying, 'fechado'::character varying, 'auditado'::character varying])::text[])))
);


ALTER TABLE public.inventario OWNER TO postgres;

--
-- TOC entry 418 (class 1259 OID 74777)
-- Name: inventario_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.inventario_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.inventario_id_seq OWNER TO postgres;

--
-- TOC entry 6507 (class 0 OID 0)
-- Dependencies: 418
-- Name: inventario_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.inventario_id_seq OWNED BY public.inventario.id;


--
-- TOC entry 456 (class 1259 OID 125714)
-- Name: locais_estoque_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.locais_estoque_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.locais_estoque_id_seq OWNER TO postgres;

--
-- TOC entry 6508 (class 0 OID 0)
-- Dependencies: 456
-- Name: locais_estoque_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.locais_estoque_id_seq OWNED BY public.locais_estoque.id;


--
-- TOC entry 366 (class 1259 OID 65866)
-- Name: logs_apontamento; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.logs_apontamento (
    id integer NOT NULL,
    id_apontamento integer,
    id_operador integer,
    tipo_evento text NOT NULL,
    mensagem text,
    dados jsonb,
    data_criacao timestamp without time zone DEFAULT now(),
    nivel character varying(50) DEFAULT 'INFO'::character varying,
    origem character varying(10) DEFAULT 'BACKEND'::character varying
);


ALTER TABLE public.logs_apontamento OWNER TO postgres;

--
-- TOC entry 365 (class 1259 OID 65865)
-- Name: logs_apontamento_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.logs_apontamento_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.logs_apontamento_id_seq OWNER TO postgres;

--
-- TOC entry 6509 (class 0 OID 0)
-- Dependencies: 365
-- Name: logs_apontamento_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.logs_apontamento_id_seq OWNED BY public.logs_apontamento.id;


--
-- TOC entry 447 (class 1259 OID 90784)
-- Name: logs_impressao; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.logs_impressao (
    id integer NOT NULL,
    id_produto integer,
    codigo_barras text,
    comandos text,
    data_hora timestamp without time zone DEFAULT now(),
    status text,
    erro text,
    id_operador integer,
    quantidade integer DEFAULT 1,
    tipo_codigo text DEFAULT 'EAN13'::text,
    data_hora_fim timestamp without time zone
);


ALTER TABLE public.logs_impressao OWNER TO postgres;

--
-- TOC entry 446 (class 1259 OID 90783)
-- Name: logs_impressao_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.logs_impressao_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.logs_impressao_id_seq OWNER TO postgres;

--
-- TOC entry 6510 (class 0 OID 0)
-- Dependencies: 446
-- Name: logs_impressao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.logs_impressao_id_seq OWNED BY public.logs_impressao.id;


--
-- TOC entry 548 (class 1259 OID 16727646)
-- Name: logs_sistema; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.logs_sistema (
    id integer NOT NULL,
    tipo character varying(20) NOT NULL,
    mensagem text NOT NULL,
    data_criacao timestamp without time zone DEFAULT now()
);


ALTER TABLE public.logs_sistema OWNER TO postgres;

--
-- TOC entry 547 (class 1259 OID 16727645)
-- Name: logs_sistema_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.logs_sistema_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.logs_sistema_id_seq OWNER TO postgres;

--
-- TOC entry 6512 (class 0 OID 0)
-- Dependencies: 547
-- Name: logs_sistema_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.logs_sistema_id_seq OWNED BY public.logs_sistema.id;


--
-- TOC entry 516 (class 1259 OID 14395554)
-- Name: maquina_molde; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.maquina_molde (
    id bigint NOT NULL,
    id_maquina integer NOT NULL,
    id_molde integer NOT NULL,
    ativo boolean DEFAULT true NOT NULL,
    prioridade_sequencia integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.maquina_molde OWNER TO postgres;

--
-- TOC entry 515 (class 1259 OID 14395553)
-- Name: maquina_molde_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.maquina_molde_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.maquina_molde_id_seq OWNER TO postgres;

--
-- TOC entry 6515 (class 0 OID 0)
-- Dependencies: 515
-- Name: maquina_molde_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.maquina_molde_id_seq OWNED BY public.maquina_molde.id;


--
-- TOC entry 434 (class 1259 OID 75092)
-- Name: maquina_tipos_processo; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.maquina_tipos_processo (
    maquina_tipo character varying(50) NOT NULL,
    tipo_processo character varying(10) NOT NULL
);


ALTER TABLE public.maquina_tipos_processo OWNER TO postgres;

--
-- TOC entry 357 (class 1259 OID 49421)
-- Name: maquinas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.maquinas (
    id integer NOT NULL,
    descricao character varying(200) NOT NULL,
    tipo_maquina character varying(100) NOT NULL,
    data_aquisicao date NOT NULL,
    quantidade_operadores integer NOT NULL,
    exige_iniciar_operacao boolean NOT NULL,
    considera_qualidade boolean NOT NULL,
    considera_eficiencia boolean NOT NULL,
    ativo boolean DEFAULT true,
    tipo_processo character varying(10)
);


ALTER TABLE public.maquinas OWNER TO postgres;

--
-- TOC entry 356 (class 1259 OID 49420)
-- Name: maquinas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.maquinas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.maquinas_id_seq OWNER TO postgres;

--
-- TOC entry 6517 (class 0 OID 0)
-- Dependencies: 356
-- Name: maquinas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.maquinas_id_seq OWNED BY public.maquinas.id;


--
-- TOC entry 449 (class 1259 OID 105025)
-- Name: metricas_desempenho; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.metricas_desempenho (
    id integer NOT NULL,
    device_id character varying(100),
    total_pulsos integer,
    batches_enviados integer,
    batches_falhas integer,
    tempo_resposta_ms integer,
    "timestamp" timestamp without time zone DEFAULT now()
);


ALTER TABLE public.metricas_desempenho OWNER TO postgres;

--
-- TOC entry 448 (class 1259 OID 105024)
-- Name: metricas_desempenho_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.metricas_desempenho_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.metricas_desempenho_id_seq OWNER TO postgres;

--
-- TOC entry 6518 (class 0 OID 0)
-- Dependencies: 448
-- Name: metricas_desempenho_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.metricas_desempenho_id_seq OWNED BY public.metricas_desempenho.id;


--
-- TOC entry 410 (class 1259 OID 74470)
-- Name: modulos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.modulos (
    id integer NOT NULL,
    id_rua integer NOT NULL,
    codigo character varying(10) NOT NULL,
    descricao character varying(100)
);


ALTER TABLE public.modulos OWNER TO postgres;

--
-- TOC entry 409 (class 1259 OID 74469)
-- Name: modulos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.modulos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.modulos_id_seq OWNER TO postgres;

--
-- TOC entry 6519 (class 0 OID 0)
-- Dependencies: 409
-- Name: modulos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.modulos_id_seq OWNED BY public.modulos.id;


--
-- TOC entry 382 (class 1259 OID 74141)
-- Name: moldes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.moldes (
    id integer NOT NULL,
    codigo character varying(50) NOT NULL,
    descricao character varying(100) NOT NULL,
    id_maquina integer,
    ativo boolean DEFAULT true,
    data_criacao timestamp without time zone DEFAULT now(),
    data_atualizacao timestamp without time zone DEFAULT now(),
    cavidades integer,
    tempo_ciclo integer DEFAULT 30
);


ALTER TABLE public.moldes OWNER TO postgres;

--
-- TOC entry 381 (class 1259 OID 74140)
-- Name: moldes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.moldes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.moldes_id_seq OWNER TO postgres;

--
-- TOC entry 6520 (class 0 OID 0)
-- Dependencies: 381
-- Name: moldes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.moldes_id_seq OWNED BY public.moldes.id;


--
-- TOC entry 388 (class 1259 OID 74198)
-- Name: moldes_maquinas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.moldes_maquinas (
    id integer NOT NULL,
    id_molde integer,
    id_maquina integer
);


ALTER TABLE public.moldes_maquinas OWNER TO postgres;

--
-- TOC entry 387 (class 1259 OID 74197)
-- Name: moldes_maquinas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.moldes_maquinas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.moldes_maquinas_id_seq OWNER TO postgres;

--
-- TOC entry 6521 (class 0 OID 0)
-- Dependencies: 387
-- Name: moldes_maquinas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.moldes_maquinas_id_seq OWNED BY public.moldes_maquinas.id;


--
-- TOC entry 386 (class 1259 OID 74175)
-- Name: moldes_produtos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.moldes_produtos (
    id integer NOT NULL,
    id_versao_molde integer,
    id_produto integer,
    referencia_produto character varying(50),
    descricao_produto character varying(100),
    data_criacao timestamp without time zone DEFAULT now(),
    cavidades integer DEFAULT 1 NOT NULL
);


ALTER TABLE public.moldes_produtos OWNER TO postgres;

--
-- TOC entry 385 (class 1259 OID 74174)
-- Name: moldes_produtos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.moldes_produtos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.moldes_produtos_id_seq OWNER TO postgres;

--
-- TOC entry 6522 (class 0 OID 0)
-- Dependencies: 385
-- Name: moldes_produtos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.moldes_produtos_id_seq OWNED BY public.moldes_produtos.id;


--
-- TOC entry 384 (class 1259 OID 74160)
-- Name: moldes_versoes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.moldes_versoes (
    id integer NOT NULL,
    id_molde integer,
    versao character varying(50) NOT NULL,
    data_criacao timestamp without time zone DEFAULT now(),
    data_atualizacao timestamp without time zone
);


ALTER TABLE public.moldes_versoes OWNER TO postgres;

--
-- TOC entry 383 (class 1259 OID 74159)
-- Name: moldes_versoes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.moldes_versoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.moldes_versoes_id_seq OWNER TO postgres;

--
-- TOC entry 6523 (class 0 OID 0)
-- Dependencies: 383
-- Name: moldes_versoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.moldes_versoes_id_seq OWNED BY public.moldes_versoes.id;


--
-- TOC entry 368 (class 1259 OID 65894)
-- Name: motivos_refugo; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.motivos_refugo (
    id integer NOT NULL,
    descricao character varying(100) NOT NULL,
    tipo character varying(50) NOT NULL,
    ativo boolean DEFAULT true
);


ALTER TABLE public.motivos_refugo OWNER TO postgres;

--
-- TOC entry 367 (class 1259 OID 65893)
-- Name: motivos_refugo_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.motivos_refugo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.motivos_refugo_id_seq OWNER TO postgres;

--
-- TOC entry 6524 (class 0 OID 0)
-- Dependencies: 367
-- Name: motivos_refugo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.motivos_refugo_id_seq OWNED BY public.motivos_refugo.id;


--
-- TOC entry 440 (class 1259 OID 78816)
-- Name: movimentacoes_estoque; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.movimentacoes_estoque (
    id integer NOT NULL,
    tipo_movimentacao_id integer,
    produto_id integer NOT NULL,
    posicao_id integer,
    quantidade integer NOT NULL,
    documento character varying(50),
    data_hora timestamp without time zone DEFAULT now(),
    operador_id integer,
    observacao text,
    id_inventario integer,
    quantidade_consumo numeric(12,4),
    id_unidade_consumo integer,
    quantidade_entrada numeric(12,4),
    id_unidade_entrada integer,
    CONSTRAINT movimentacoes_estoque_quantidade_check CHECK ((quantidade > 0))
);


ALTER TABLE public.movimentacoes_estoque OWNER TO postgres;

--
-- TOC entry 439 (class 1259 OID 78815)
-- Name: movimentacoes_estoque_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.movimentacoes_estoque_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.movimentacoes_estoque_id_seq OWNER TO postgres;

--
-- TOC entry 6525 (class 0 OID 0)
-- Dependencies: 439
-- Name: movimentacoes_estoque_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.movimentacoes_estoque_id_seq OWNED BY public.movimentacoes_estoque.id;


--
-- TOC entry 425 (class 1259 OID 75007)
-- Name: nao_conformidades; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.nao_conformidades (
    id integer NOT NULL,
    descricao text NOT NULL,
    gravidade character varying(20)
);


ALTER TABLE public.nao_conformidades OWNER TO postgres;

--
-- TOC entry 424 (class 1259 OID 75006)
-- Name: nao_conformidades_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.nao_conformidades_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.nao_conformidades_id_seq OWNER TO postgres;

--
-- TOC entry 6526 (class 0 OID 0)
-- Dependencies: 424
-- Name: nao_conformidades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.nao_conformidades_id_seq OWNED BY public.nao_conformidades.id;


--
-- TOC entry 412 (class 1259 OID 74484)
-- Name: niveis; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.niveis (
    id integer NOT NULL,
    id_modulo integer NOT NULL,
    codigo character varying(10) NOT NULL,
    descricao character varying(100)
);


ALTER TABLE public.niveis OWNER TO postgres;

--
-- TOC entry 411 (class 1259 OID 74483)
-- Name: niveis_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.niveis_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.niveis_id_seq OWNER TO postgres;

--
-- TOC entry 6527 (class 0 OID 0)
-- Dependencies: 411
-- Name: niveis_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.niveis_id_seq OWNED BY public.niveis.id;


--
-- TOC entry 451 (class 1259 OID 105033)
-- Name: oee_calculado; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.oee_calculado (
    id integer NOT NULL,
    id_maquina integer,
    id_produto integer,
    id_apontamento integer,
    data_calculo timestamp without time zone DEFAULT now(),
    periodo_inicio timestamp without time zone,
    periodo_fim timestamp without time zone,
    disponibilidade numeric(5,2),
    performance numeric(5,2),
    qualidade numeric(5,2),
    oee numeric(5,2),
    tempo_total_segundos integer,
    tempo_paradas_segundos integer,
    tempo_producao_segundos integer,
    pecas_produzidas integer,
    pecas_boas integer,
    pecas_defeituosas integer,
    velocidade_ideal_pecas_hora integer,
    velocidade_real_pecas_hora integer,
    meta_atingida boolean
);


ALTER TABLE public.oee_calculado OWNER TO postgres;

--
-- TOC entry 450 (class 1259 OID 105032)
-- Name: oee_calculado_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.oee_calculado_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.oee_calculado_id_seq OWNER TO postgres;

--
-- TOC entry 6528 (class 0 OID 0)
-- Dependencies: 450
-- Name: oee_calculado_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.oee_calculado_id_seq OWNED BY public.oee_calculado.id;


--
-- TOC entry 355 (class 1259 OID 49412)
-- Name: operadores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.operadores (
    id integer NOT NULL,
    nome character varying(100) NOT NULL,
    email character varying(100),
    senha character varying(100) NOT NULL,
    administrador boolean DEFAULT false,
    turno character varying(10),
    tipo_operador public.tipo_operador_enum,
    data_cadastro date DEFAULT now(),
    cargo character varying(150),
    telefone character varying(30),
    foto_url text
);


ALTER TABLE public.operadores OWNER TO postgres;

--
-- TOC entry 370 (class 1259 OID 65924)
-- Name: operadores_faces; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.operadores_faces (
    id integer NOT NULL,
    operador_id integer NOT NULL,
    face_descriptor jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.operadores_faces OWNER TO postgres;

--
-- TOC entry 369 (class 1259 OID 65923)
-- Name: operadores_faces_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.operadores_faces_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.operadores_faces_id_seq OWNER TO postgres;

--
-- TOC entry 6529 (class 0 OID 0)
-- Dependencies: 369
-- Name: operadores_faces_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.operadores_faces_id_seq OWNED BY public.operadores_faces.id;


--
-- TOC entry 354 (class 1259 OID 49411)
-- Name: operadores_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.operadores_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.operadores_id_seq OWNER TO postgres;

--
-- TOC entry 6530 (class 0 OID 0)
-- Dependencies: 354
-- Name: operadores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.operadores_id_seq OWNED BY public.operadores.id;


--
-- TOC entry 471 (class 1259 OID 194588)
-- Name: operadores_status; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.operadores_status (
    id integer NOT NULL,
    operador_id integer,
    online boolean DEFAULT false,
    ultima_atividade timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    socket_id character varying(255),
    ip_conexao character varying(45)
);


ALTER TABLE public.operadores_status OWNER TO postgres;

--
-- TOC entry 470 (class 1259 OID 194587)
-- Name: operadores_status_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.operadores_status_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.operadores_status_id_seq OWNER TO postgres;

--
-- TOC entry 6531 (class 0 OID 0)
-- Dependencies: 470
-- Name: operadores_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.operadores_status_id_seq OWNED BY public.operadores_status.id;


--
-- TOC entry 364 (class 1259 OID 57635)
-- Name: ordem_producao; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ordem_producao (
    id character varying(50) NOT NULL,
    id_produto integer NOT NULL,
    quantidade integer NOT NULL,
    data_inicio timestamp without time zone DEFAULT now(),
    data_fim timestamp without time zone,
    status character varying(20) DEFAULT 'PENDENTE'::character varying,
    id_operador_responsavel integer,
    observacoes text,
    quantidade_restante numeric,
    id_molde integer,
    id_molde_versao integer,
    tempo_setup_minutos numeric(18,3) DEFAULT 0 NOT NULL,
    id_ordem_pai character varying(50),
    id_ordem_raiz character varying(50),
    nivel_estrutura integer DEFAULT 0 NOT NULL,
    gerada_automaticamente boolean DEFAULT false NOT NULL,
    origem_automacao character varying(40)
);


ALTER TABLE public.ordem_producao OWNER TO postgres;

--
-- TOC entry 532 (class 1259 OID 16372742)
-- Name: ordem_producao_estrutura_itens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ordem_producao_estrutura_itens (
    id bigint NOT NULL,
    id_ordem_producao character varying(50) NOT NULL,
    id_ordem_raiz character varying(50) NOT NULL,
    id_estrutura_aworks bigint,
    nivel integer DEFAULT 1 NOT NULL,
    caminho text NOT NULL,
    id_produto_pai_cache integer NOT NULL,
    id_produto_pai_local integer,
    id_produto_componente_cache integer NOT NULL,
    id_produto_componente_local integer,
    referencia_componente text,
    descricao_componente text,
    quantidade_por_unidade numeric(18,6) DEFAULT 0 NOT NULL,
    perda_percentual numeric(10,4),
    fator_acumulado numeric(20,8) DEFAULT 0 NOT NULL,
    quantidade_necessaria numeric(18,6) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.ordem_producao_estrutura_itens OWNER TO postgres;

--
-- TOC entry 531 (class 1259 OID 16372741)
-- Name: ordem_producao_estrutura_itens_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ordem_producao_estrutura_itens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ordem_producao_estrutura_itens_id_seq OWNER TO postgres;

--
-- TOC entry 6533 (class 0 OID 0)
-- Dependencies: 531
-- Name: ordem_producao_estrutura_itens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ordem_producao_estrutura_itens_id_seq OWNED BY public.ordem_producao_estrutura_itens.id;


--
-- TOC entry 534 (class 1259 OID 16372761)
-- Name: ordem_producao_necessidades; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ordem_producao_necessidades (
    id bigint NOT NULL,
    id_ordem_producao character varying(50) NOT NULL,
    id_ordem_raiz character varying(50) NOT NULL,
    id_produto_cache integer NOT NULL,
    id_produto_local integer,
    referencia_produto text,
    descricao_produto text,
    quantidade_necessaria numeric(18,6) DEFAULT 0 NOT NULL,
    quantidade_atendida numeric(18,6) DEFAULT 0 NOT NULL,
    tipo_atendimento character varying(20) DEFAULT 'PRODUZIR'::character varying NOT NULL,
    status character varying(20) DEFAULT 'PENDENTE'::character varying NOT NULL,
    id_ordem_producao_filha character varying(50),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.ordem_producao_necessidades OWNER TO postgres;

--
-- TOC entry 533 (class 1259 OID 16372760)
-- Name: ordem_producao_necessidades_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ordem_producao_necessidades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ordem_producao_necessidades_id_seq OWNER TO postgres;

--
-- TOC entry 6536 (class 0 OID 0)
-- Dependencies: 533
-- Name: ordem_producao_necessidades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ordem_producao_necessidades_id_seq OWNED BY public.ordem_producao_necessidades.id;


--
-- TOC entry 363 (class 1259 OID 49491)
-- Name: paradas_producao; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.paradas_producao (
    id integer NOT NULL,
    id_apontamento integer NOT NULL,
    motivo_parada text NOT NULL,
    data_inicio timestamp without time zone NOT NULL,
    data_fim timestamp without time zone
);


ALTER TABLE public.paradas_producao OWNER TO postgres;

--
-- TOC entry 362 (class 1259 OID 49490)
-- Name: paradas_producao_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.paradas_producao_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.paradas_producao_id_seq OWNER TO postgres;

--
-- TOC entry 6538 (class 0 OID 0)
-- Dependencies: 362
-- Name: paradas_producao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.paradas_producao_id_seq OWNED BY public.paradas_producao.id;


--
-- TOC entry 523 (class 1259 OID 15130971)
-- Name: pedido_itens_aworks_simples_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: postgres
--

CREATE MATERIALIZED VIEW public.pedido_itens_aworks_simples_mv AS
 SELECT pedidovendaitemid,
    pedidovendaid,
    produtoid,
    ds_produto,
    quantidade_total,
    quantidade_entrega,
    vl_unitario,
    vl_total,
    referencia,
    almoxarifadoid,
    quantidade_despachada
   FROM public.dblink('dbname=AWORKSDB host=192.168.10.252 user=postgres password=aw2000'::text, '
    SELECT
        pvi.pedidovendaitemid::integer,
        pvi.pedidovendaid::integer,
        pvi.produtoid::integer,
        pvi.ds_produto_pedidovenda_item::text,
        pvi.qt_pedidovenda_item::numeric AS quantidade_total,
        GREATEST(
            COALESCE(NULLIF(pvi.qt_entrega_pedidovenda_item, 0), pvi.qt_pedidovenda_item, 0),
            0
        )::numeric AS quantidade_entrega,
        pvi.vl_unit_pedidovenda_item::numeric AS vl_unitario,
        pvi.vl_total_pedidovenda_item::numeric AS vl_total,
        pr.referencia_produto::text,
        pvi.almoxarifadoid::integer,
        COALESCE(pvi.qt_despacho, 0)::numeric AS quantidade_despachada
    FROM pedidovenda_item pvi
    LEFT JOIN produto pr ON pvi.produtoid = pr.produtoid
    WHERE GREATEST(
            COALESCE(NULLIF(pvi.qt_entrega_pedidovenda_item, 0), pvi.qt_pedidovenda_item, 0),
            0
        ) > 0
    '::text) t(pedidovendaitemid integer, pedidovendaid integer, produtoid integer, ds_produto text, quantidade_total numeric, quantidade_entrega numeric, vl_unitario numeric, vl_total numeric, referencia text, almoxarifadoid integer, quantidade_despachada numeric)
  WITH NO DATA;


ALTER MATERIALIZED VIEW public.pedido_itens_aworks_simples_mv OWNER TO postgres;

--
-- TOC entry 6539 (class 0 OID 0)
-- Dependencies: 523
-- Name: MATERIALIZED VIEW pedido_itens_aworks_simples_mv; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON MATERIALIZED VIEW public.pedido_itens_aworks_simples_mv IS 'Materialized view com itens de pedidos do AWORKS - versão original sem dt_despacho';


--
-- TOC entry 472 (class 1259 OID 206126)
-- Name: pedidos_despacho_previsto; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pedidos_despacho_previsto (
    pedidovendaid integer NOT NULL,
    data_despacho_prevista timestamp without time zone,
    usuario_id integer,
    data_atualizacao timestamp without time zone DEFAULT now()
);


ALTER TABLE public.pedidos_despacho_previsto OWNER TO postgres;

--
-- TOC entry 503 (class 1259 OID 9861888)
-- Name: pedidos_prontos_despacho_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: postgres
--

CREATE MATERIALIZED VIEW public.pedidos_prontos_despacho_mv AS
 SELECT DISTINCT ON (pv.pedidovendaid) pv.pedidovendaid AS id,
    pv.nr_nota_pedidovenda,
    pv.dt_faturamento_pedidovenda,
    pv.dt_entdesejada_pedidovenda,
    c.nome_cadcftv AS cliente_nome,
    cd.nome_cidade AS cidade,
    cd.uf_cidade AS uf,
    pv.vl_total_pedidovenda AS valor_total,
    pv.vl_pesobruto_pedidovenda AS peso_bruto,
    pv.vl_pesoliq_pedidovenda AS peso_liquido,
    pv.qt_volume_pedidovenda AS volumes,
    pv.filialid,
    COALESCE(pv.obs_ped1_pedidovenda, pv.obs_ped2_pedidovenda, ''::text) AS observacoes,
    pv.status_pedidovenda AS status_pedido,
    NULL::timestamp without time zone AS data_despacho_prevista,
    'PENDENTE'::text AS status_despacho
   FROM (((public.dblink('dbname=AWORKSDB host=192.168.10.252 user=postgres password=aw2000'::text, '
    SELECT 
        pv.pedidovendaid,
        pv.nr_nota_pedidovenda,
        pv.dt_faturamento_pedidovenda,
        pv.dt_entdesejada_pedidovenda,
        pv.vl_total_pedidovenda,
        pv.vl_pesobruto_pedidovenda,
        pv.vl_pesoliq_pedidovenda,
        pv.qt_volume_pedidovenda,
        pv.filialid,
        pv.obs_ped1_pedidovenda,
        pv.obs_ped2_pedidovenda,
        pv.status_pedidovenda,
        pv.cadcftvid
    FROM pedidovenda pv
    WHERE pv.status_pedidovenda = ''FATURADO''
        AND pv.dt_faturamento_pedidovenda IS NOT NULL
        AND pv.vl_pesobruto_pedidovenda > 0
        AND pv.empresaid = 1
        AND pv.filialid IN (1, 2)
        AND pv.dt_faturamento_pedidovenda > ''2025-01-01''
        AND NOT EXISTS (
            SELECT 1 FROM despacho_pedidovenda dp 
            JOIN despacho d ON dp.despachoid = d.despachoid 
            WHERE dp.pedidovendaid = pv.pedidovendaid 
            AND d.dt_hr_despacho IS NOT NULL
        )
    '::text) pv(pedidovendaid integer, nr_nota_pedidovenda text, dt_faturamento_pedidovenda timestamp without time zone, dt_entdesejada_pedidovenda timestamp without time zone, vl_total_pedidovenda numeric, vl_pesobruto_pedidovenda numeric, vl_pesoliq_pedidovenda numeric, qt_volume_pedidovenda integer, filialid integer, obs_ped1_pedidovenda text, obs_ped2_pedidovenda text, status_pedidovenda text, cadcftvid integer)
     LEFT JOIN public.dblink('dbname=AWORKSDB host=192.168.10.252 user=postgres password=aw2000'::text, 'SELECT cadcftvid, nome_cadcftv FROM cadcftv'::text) c(cadcftvid integer, nome_cadcftv text) ON ((pv.cadcftvid = c.cadcftvid)))
     LEFT JOIN public.dblink('dbname=AWORKSDB host=192.168.10.252 user=postgres password=aw2000'::text, 'SELECT DISTINCT ON (cadcftvid) cadcftvid, cidadeid FROM endcadcftv ORDER BY cadcftvid, endcadcftvid'::text) ec(cadcftvid integer, cidadeid integer) ON ((pv.cadcftvid = ec.cadcftvid)))
     LEFT JOIN public.dblink('dbname=AWORKSDB host=192.168.10.252 user=postgres password=aw2000'::text, 'SELECT cidadeid, nome_cidade, uf_cidade FROM cidade'::text) cd(cidadeid integer, nome_cidade text, uf_cidade text) ON ((ec.cidadeid = cd.cidadeid)))
  ORDER BY pv.pedidovendaid, c.nome_cadcftv, cd.nome_cidade
  WITH NO DATA;


ALTER MATERIALIZED VIEW public.pedidos_prontos_despacho_mv OWNER TO postgres;

--
-- TOC entry 390 (class 1259 OID 74220)
-- Name: planejamento_producao; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.planejamento_producao (
    id integer NOT NULL,
    id_molde integer,
    id_maquina integer,
    quantidade integer NOT NULL,
    tempo_estimado numeric(10,2) NOT NULL,
    data_inicio timestamp without time zone NOT NULL,
    data_fim timestamp without time zone NOT NULL,
    status character varying(20) DEFAULT 'pendente'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    turno character varying(1),
    tipo character varying(20) DEFAULT 'producao'::character varying NOT NULL,
    descricao text,
    motivo character varying(100),
    id_molde_antigo integer,
    CONSTRAINT check_tipo CHECK (((tipo)::text = ANY ((ARRAY['producao'::character varying, 'manutencao'::character varying, 'troca_molde'::character varying])::text[]))),
    CONSTRAINT check_turno CHECK (((turno IS NULL) OR ((turno)::text = ANY ((ARRAY['A'::character varying, 'B'::character varying, 'C'::character varying])::text[])))),
    CONSTRAINT planejamento_producao_status_check CHECK (((status)::text = ANY (ARRAY['pendente'::text, 'planejado'::text, 'em_andamento'::text, 'concluido'::text, 'parado'::text, 'cancelado'::text, 'disponivel'::text])))
);


ALTER TABLE public.planejamento_producao OWNER TO postgres;

--
-- TOC entry 389 (class 1259 OID 74219)
-- Name: planejamento_producao_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.planejamento_producao_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.planejamento_producao_id_seq OWNER TO postgres;

--
-- TOC entry 6542 (class 0 OID 0)
-- Dependencies: 389
-- Name: planejamento_producao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.planejamento_producao_id_seq OWNED BY public.planejamento_producao.id;


--
-- TOC entry 413 (class 1259 OID 74497)
-- Name: posicoes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.posicoes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.posicoes_id_seq OWNER TO postgres;

--
-- TOC entry 6543 (class 0 OID 0)
-- Dependencies: 413
-- Name: posicoes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.posicoes_id_seq OWNED BY public.posicoes.id;


--
-- TOC entry 442 (class 1259 OID 78893)
-- Name: produto_id_mapping; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.produto_id_mapping (
    id integer NOT NULL,
    id_original integer NOT NULL,
    id_cache integer NOT NULL,
    referencia_produto text NOT NULL,
    data_mapeamento timestamp without time zone DEFAULT now(),
    ativo boolean DEFAULT true
);


ALTER TABLE public.produto_id_mapping OWNER TO postgres;

--
-- TOC entry 441 (class 1259 OID 78892)
-- Name: produto_id_mapping_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.produto_id_mapping_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.produto_id_mapping_id_seq OWNER TO postgres;

--
-- TOC entry 6544 (class 0 OID 0)
-- Dependencies: 441
-- Name: produto_id_mapping_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.produto_id_mapping_id_seq OWNED BY public.produto_id_mapping.id;


--
-- TOC entry 508 (class 1259 OID 11428073)
-- Name: produtos_cache; Type: MATERIALIZED VIEW; Schema: public; Owner: postgres
--

CREATE MATERIALIZED VIEW public.produtos_cache AS
 SELECT id,
    descricao,
    referencia,
    referencia_original_produto AS ean13,
    tp_produto,
    vl_pesobruto_produto
   FROM public.dblink('dbname=AWORKSDB host=192.168.10.252 user=postgres password=aw2000'::text, 'SELECT 
        produtoid::integer AS id, 
        ds_produto::text AS descricao, 
        referencia_produto::text AS referencia,
        referencia_original_produto::text AS referencia_original_produto,
      tp_produto::text AS tp_produto,
      COALESCE(vl_pesobruto_produto, 0)::numeric(15,6) AS vl_pesobruto_produto
     FROM produto 
     WHERE status_produto = ''ATIVO'' 
     AND empresaid = 1
     ORDER BY produtoid'::text) t(id integer, descricao text, referencia text, referencia_original_produto text, tp_produto text, vl_pesobruto_produto numeric(15,6))
  WITH NO DATA;


ALTER MATERIALIZED VIEW public.produtos_cache OWNER TO postgres;

--
-- TOC entry 445 (class 1259 OID 90766)
-- Name: produtos_ean14; Type: MATERIALIZED VIEW; Schema: public; Owner: postgres
--

CREATE MATERIALIZED VIEW public.produtos_ean14 AS
 SELECT row_number() OVER () AS id,
    produtoid AS id_produto,
    codigo_ean14 AS ean14,
    qtde_ean14 AS quantidade
   FROM public.dblink('dbname=AWORKSDB host=192.168.10.252 user=postgres password=aw2000'::text, 'SELECT 
       produtoid, 
       codigo_ean14, 
       qtde_ean14
     FROM produto_ean14
     ORDER BY produtoid, codigo_ean14'::text) t(produtoid numeric, codigo_ean14 text, qtde_ean14 numeric)
  WITH NO DATA;


ALTER MATERIALIZED VIEW public.produtos_ean14 OWNER TO postgres;

--
-- TOC entry 358 (class 1259 OID 49441)
-- Name: produtos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.produtos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.produtos_id_seq OWNER TO postgres;

--
-- TOC entry 6546 (class 0 OID 0)
-- Dependencies: 358
-- Name: produtos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.produtos_id_seq OWNED BY public.produtos.id;


--
-- TOC entry 474 (class 1259 OID 3088795)
-- Name: pulse; Type: TABLE; Schema: public; Owner: metabase_user
--

CREATE TABLE public.pulse (
    id integer NOT NULL,
    creator_id integer NOT NULL,
    name character varying(254),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    skip_if_empty boolean DEFAULT false NOT NULL,
    alert_condition character varying(254),
    alert_first_only boolean,
    alert_above_goal boolean,
    collection_id integer,
    collection_position smallint,
    archived boolean DEFAULT false,
    dashboard_id integer,
    parameters text NOT NULL,
    entity_id character(21)
);


ALTER TABLE public.pulse OWNER TO metabase_user;

--
-- TOC entry 475 (class 1259 OID 3088819)
-- Name: pulse_id_seq; Type: SEQUENCE; Schema: public; Owner: metabase_user
--

ALTER TABLE public.pulse ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.pulse_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 399 (class 1259 OID 74325)
-- Name: pulsos_maquina; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pulsos_maquina (
    id integer NOT NULL,
    id_maquina character varying(20) NOT NULL,
    pulsos integer NOT NULL,
    cavidades integer NOT NULL,
    pecas_calculadas integer NOT NULL,
    data_registro timestamp without time zone DEFAULT now()
);


ALTER TABLE public.pulsos_maquina OWNER TO postgres;

--
-- TOC entry 398 (class 1259 OID 74324)
-- Name: pulsos_maquina_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pulsos_maquina_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pulsos_maquina_id_seq OWNER TO postgres;

--
-- TOC entry 6547 (class 0 OID 0)
-- Dependencies: 398
-- Name: pulsos_maquina_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.pulsos_maquina_id_seq OWNED BY public.pulsos_maquina.id;


--
-- TOC entry 484 (class 1259 OID 3846791)
-- Name: relatorios_falta_estoque; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.relatorios_falta_estoque (
    id integer NOT NULL,
    pedidovendaid integer NOT NULL,
    id_operador integer NOT NULL,
    dados_itens jsonb NOT NULL,
    observacao text,
    data_relatorio timestamp without time zone DEFAULT now() NOT NULL,
    status character varying(20) DEFAULT 'ABERTO'::character varying NOT NULL,
    data_resolucao timestamp without time zone,
    id_operador_resolucao integer,
    observacao_resolucao text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT relatorios_falta_estoque_status_check CHECK (((status)::text = ANY ((ARRAY['ABERTO'::character varying, 'RESOLVIDO'::character varying])::text[])))
);


ALTER TABLE public.relatorios_falta_estoque OWNER TO postgres;

--
-- TOC entry 6548 (class 0 OID 0)
-- Dependencies: 484
-- Name: TABLE relatorios_falta_estoque; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.relatorios_falta_estoque IS 'Tabela para registrar relatórios de falta de produtos no estoque';


--
-- TOC entry 6549 (class 0 OID 0)
-- Dependencies: 484
-- Name: COLUMN relatorios_falta_estoque.pedidovendaid; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.relatorios_falta_estoque.pedidovendaid IS 'ID do pedido com falta de produtos';


--
-- TOC entry 6550 (class 0 OID 0)
-- Dependencies: 484
-- Name: COLUMN relatorios_falta_estoque.id_operador; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.relatorios_falta_estoque.id_operador IS 'ID do operador que reportou a falta';


--
-- TOC entry 6551 (class 0 OID 0)
-- Dependencies: 484
-- Name: COLUMN relatorios_falta_estoque.dados_itens; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.relatorios_falta_estoque.dados_itens IS 'JSON com informações dos itens em falta';


--
-- TOC entry 6552 (class 0 OID 0)
-- Dependencies: 484
-- Name: COLUMN relatorios_falta_estoque.status; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.relatorios_falta_estoque.status IS 'Status do relatório: ABERTO ou RESOLVIDO';


--
-- TOC entry 6553 (class 0 OID 0)
-- Dependencies: 484
-- Name: COLUMN relatorios_falta_estoque.data_resolucao; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.relatorios_falta_estoque.data_resolucao IS 'Data em que o problema foi resolvido';


--
-- TOC entry 6554 (class 0 OID 0)
-- Dependencies: 484
-- Name: COLUMN relatorios_falta_estoque.id_operador_resolucao; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.relatorios_falta_estoque.id_operador_resolucao IS 'ID do operador que resolveu o problema';


--
-- TOC entry 6555 (class 0 OID 0)
-- Dependencies: 484
-- Name: COLUMN relatorios_falta_estoque.observacao_resolucao; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.relatorios_falta_estoque.observacao_resolucao IS 'Observações sobre como o problema foi resolvido';


--
-- TOC entry 483 (class 1259 OID 3846790)
-- Name: relatorios_falta_estoque_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.relatorios_falta_estoque_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.relatorios_falta_estoque_id_seq OWNER TO postgres;

--
-- TOC entry 6557 (class 0 OID 0)
-- Dependencies: 483
-- Name: relatorios_falta_estoque_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.relatorios_falta_estoque_id_seq OWNED BY public.relatorios_falta_estoque.id;


--
-- TOC entry 536 (class 1259 OID 16424319)
-- Name: requisicao_compra; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.requisicao_compra (
    id integer NOT NULL,
    numero_requisicao character varying(20) NOT NULL,
    id_produto integer NOT NULL,
    quantidade_necessaria numeric(15,6) NOT NULL,
    quantidade_solicitada numeric(15,6) NOT NULL,
    unidade character varying(10) DEFAULT 'KG'::character varying,
    data_necessidade date NOT NULL,
    status character varying(30) DEFAULT 'PENDENTE'::character varying,
    numero_oc_aworks character varying(30),
    data_emissao_oc date,
    id_operador_compra integer,
    observacoes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT requisicao_compra_status_check CHECK (((status)::text = ANY ((ARRAY['PENDENTE'::character varying, 'ANALISE'::character varying, 'APROVADA'::character varying, 'EM_COMPRA'::character varying, 'COMPRADA'::character varying, 'CANCELADA'::character varying])::text[])))
);


ALTER TABLE public.requisicao_compra OWNER TO postgres;

--
-- TOC entry 535 (class 1259 OID 16424318)
-- Name: requisicao_compra_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.requisicao_compra_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.requisicao_compra_id_seq OWNER TO postgres;

--
-- TOC entry 6560 (class 0 OID 0)
-- Dependencies: 535
-- Name: requisicao_compra_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.requisicao_compra_id_seq OWNED BY public.requisicao_compra.id;


--
-- TOC entry 490 (class 1259 OID 4333155)
-- Name: reservas_estoque; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.reservas_estoque (
    id integer NOT NULL,
    pedidovendaid integer NOT NULL,
    pedidovendaitemid integer NOT NULL,
    id_posicao integer NOT NULL,
    quantidade_reservada numeric(15,4) NOT NULL,
    data_reserva timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(20) DEFAULT 'ATIVA'::character varying NOT NULL,
    prioridade_pedido character varying(20),
    id_operador_reserva integer,
    observacoes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_prioridade_reserva CHECK (((prioridade_pedido)::text = ANY ((ARRAY['VERMELHO'::character varying, 'LARANJA'::character varying, 'AMARELO'::character varying, 'VERDE'::character varying, 'ROXO'::character varying])::text[]))),
    CONSTRAINT check_status_reserva CHECK (((status)::text = ANY ((ARRAY['ATIVA'::character varying, 'UTILIZADA'::character varying, 'CANCELADA'::character varying])::text[])))
);


ALTER TABLE public.reservas_estoque OWNER TO postgres;

--
-- TOC entry 6562 (class 0 OID 0)
-- Dependencies: 490
-- Name: TABLE reservas_estoque; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.reservas_estoque IS 'Armazena as reservas de estoque para pedidos em separação, considerando a prioridade dos pedidos';


--
-- TOC entry 6563 (class 0 OID 0)
-- Dependencies: 490
-- Name: COLUMN reservas_estoque.status; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.reservas_estoque.status IS 'ATIVA: reserva ativa | UTILIZADA: quando o item foi separado | CANCELADA: reserva cancelada';


--
-- TOC entry 6564 (class 0 OID 0)
-- Dependencies: 490
-- Name: COLUMN reservas_estoque.prioridade_pedido; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.reservas_estoque.prioridade_pedido IS 'Prioridade do pedido no momento da reserva: VERMELHO (urgente) > LARANJA (alta) > AMARELO (média) > VERDE (normal) > ROXO (sem data)';


--
-- TOC entry 489 (class 1259 OID 4333154)
-- Name: reservas_estoque_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.reservas_estoque_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.reservas_estoque_id_seq OWNER TO postgres;

--
-- TOC entry 6566 (class 0 OID 0)
-- Dependencies: 489
-- Name: reservas_estoque_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.reservas_estoque_id_seq OWNED BY public.reservas_estoque.id;


--
-- TOC entry 408 (class 1259 OID 74461)
-- Name: ruas; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ruas (
    id integer NOT NULL,
    codigo character varying(10) NOT NULL,
    descricao character varying(100)
);


ALTER TABLE public.ruas OWNER TO postgres;

--
-- TOC entry 407 (class 1259 OID 74460)
-- Name: ruas_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ruas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ruas_id_seq OWNER TO postgres;

--
-- TOC entry 6568 (class 0 OID 0)
-- Dependencies: 407
-- Name: ruas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ruas_id_seq OWNED BY public.ruas.id;


--
-- TOC entry 481 (class 1259 OID 3236266)
-- Name: separacao_itens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.separacao_itens (
    id integer NOT NULL,
    id_separacao_pedido integer,
    pedidovendaitemid integer NOT NULL,
    id_produto integer,
    id_posicao integer,
    quantidade_solicitada numeric(15,4),
    quantidade_separada numeric(15,4) DEFAULT 0,
    quantidade_conferida numeric(15,4) DEFAULT 0,
    status character varying(20) DEFAULT 'PENDENTE'::character varying,
    id_operador_separacao integer,
    id_operador_conferencia integer,
    data_separacao timestamp without time zone,
    data_conferencia timestamp without time zone,
    observacoes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    produtoid integer,
    produtoid_original integer,
    referencia character varying(100),
    bloqueado_por integer,
    data_bloqueio timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    quantidade_separada_inicial numeric(15,4) DEFAULT 0
);


ALTER TABLE public.separacao_itens OWNER TO postgres;

--
-- TOC entry 497 (class 1259 OID 6055221)
-- Name: separacao_itens_bloqueio; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.separacao_itens_bloqueio (
    id integer NOT NULL,
    pedidovendaitemid integer NOT NULL,
    pedidovendaid integer NOT NULL,
    bloqueado_por integer,
    desbloqueado_por integer,
    data_bloqueio timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    data_desbloqueio timestamp without time zone,
    quantidade_solicitada numeric(15,4),
    quantidade_separada_quando_bloqueado numeric(15,4),
    quantidade_separada_quando_desbloqueado numeric(15,4),
    motivo_desbloqueio character varying(50) DEFAULT 'FINALIZADO_PARCIAL'::character varying,
    observacoes text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.separacao_itens_bloqueio OWNER TO postgres;

--
-- TOC entry 6570 (class 0 OID 0)
-- Dependencies: 497
-- Name: TABLE separacao_itens_bloqueio; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.separacao_itens_bloqueio IS 'Histórico de bloqueios de itens para rastreamento de separação compartilhada entre operadores';


--
-- TOC entry 496 (class 1259 OID 6055220)
-- Name: separacao_itens_bloqueio_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE public.separacao_itens_bloqueio ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.separacao_itens_bloqueio_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 480 (class 1259 OID 3236265)
-- Name: separacao_itens_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.separacao_itens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.separacao_itens_id_seq OWNER TO postgres;

--
-- TOC entry 6573 (class 0 OID 0)
-- Dependencies: 480
-- Name: separacao_itens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.separacao_itens_id_seq OWNED BY public.separacao_itens.id;


--
-- TOC entry 479 (class 1259 OID 3236220)
-- Name: separacao_pedidos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.separacao_pedidos (
    id integer NOT NULL,
    pedidovendaid integer NOT NULL,
    nr_nota_fiscal character varying(50),
    cliente_nome character varying(200),
    status character varying(20) DEFAULT 'PENDENTE'::character varying,
    id_operador integer,
    data_inicio_separacao timestamp without time zone,
    data_fim_separacao timestamp without time zone,
    observacoes text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    data_prioridade_separacao date
);


ALTER TABLE public.separacao_pedidos OWNER TO postgres;

--
-- TOC entry 6575 (class 0 OID 0)
-- Dependencies: 479
-- Name: COLUMN separacao_pedidos.data_prioridade_separacao; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.separacao_pedidos.data_prioridade_separacao IS 'Data de prioridade para separação do pedido. Define a urgência de separação independente da data de despacho.';


--
-- TOC entry 478 (class 1259 OID 3236219)
-- Name: separacao_pedidos_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.separacao_pedidos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.separacao_pedidos_id_seq OWNER TO postgres;

--
-- TOC entry 6577 (class 0 OID 0)
-- Dependencies: 478
-- Name: separacao_pedidos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.separacao_pedidos_id_seq OWNED BY public.separacao_pedidos.id;


--
-- TOC entry 518 (class 1259 OID 14395568)
-- Name: setup_maquina; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.setup_maquina (
    id bigint NOT NULL,
    id_maquina integer NOT NULL,
    cor_origem character varying(80),
    cor_destino character varying(80),
    material_origem character varying(120),
    material_destino character varying(120),
    tempo_setup_minutos numeric(18,3) DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.setup_maquina OWNER TO postgres;

--
-- TOC entry 517 (class 1259 OID 14395567)
-- Name: setup_maquina_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.setup_maquina_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.setup_maquina_id_seq OWNER TO postgres;

--
-- TOC entry 6580 (class 0 OID 0)
-- Dependencies: 517
-- Name: setup_maquina_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.setup_maquina_id_seq OWNED BY public.setup_maquina.id;


--
-- TOC entry 526 (class 1259 OID 15493599)
-- Name: subgrupoproduto; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subgrupoproduto (
    subgrupoprodutoid numeric(8,0) NOT NULL,
    nome_subgrupoproduto character varying(50) NOT NULL,
    bo_ipicusto_subgrupoproduto character varying(3) DEFAULT 'NAO'::character varying,
    grupoprodutoid numeric(8,0) NOT NULL,
    ifpvid numeric(8,0) NOT NULL,
    vl_custo_hora_produto numeric(15,4) DEFAULT 0,
    vl_meta_mensal_subgrupoproduto numeric(23,4) DEFAULT 0,
    bo_verifica_mp_lote character varying(3) DEFAULT 'NAO'::character varying
);


ALTER TABLE public.subgrupoproduto OWNER TO postgres;

--
-- TOC entry 6582 (class 0 OID 0)
-- Dependencies: 526
-- Name: TABLE subgrupoproduto; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE public.subgrupoproduto IS 'Subgrupos de produtos importados do AWORKS (empresaid=1)';


--
-- TOC entry 454 (class 1259 OID 125355)
-- Name: teste_migracao; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.teste_migracao (
    id integer,
    antigo integer,
    novo integer
);


ALTER TABLE public.teste_migracao OWNER TO postgres;

--
-- TOC entry 393 (class 1259 OID 74269)
-- Name: tipos_manutencao; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tipos_manutencao (
    id integer NOT NULL,
    descricao character varying(100) NOT NULL,
    categoria character varying(50) NOT NULL,
    tempo_estimado_minutos integer,
    ativo boolean DEFAULT true,
    prioridade integer DEFAULT 3
);


ALTER TABLE public.tipos_manutencao OWNER TO postgres;

--
-- TOC entry 392 (class 1259 OID 74268)
-- Name: tipos_manutencao_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tipos_manutencao_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tipos_manutencao_id_seq OWNER TO postgres;

--
-- TOC entry 6584 (class 0 OID 0)
-- Dependencies: 392
-- Name: tipos_manutencao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tipos_manutencao_id_seq OWNED BY public.tipos_manutencao.id;


--
-- TOC entry 438 (class 1259 OID 78807)
-- Name: tipos_movimentacao; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tipos_movimentacao (
    id integer NOT NULL,
    descricao character varying(50) NOT NULL,
    operacao character(1) NOT NULL,
    ativo boolean DEFAULT true,
    CONSTRAINT tipos_movimentacao_operacao_check CHECK ((operacao = ANY (ARRAY['E'::bpchar, 'S'::bpchar])))
);


ALTER TABLE public.tipos_movimentacao OWNER TO postgres;

--
-- TOC entry 437 (class 1259 OID 78806)
-- Name: tipos_movimentacao_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tipos_movimentacao_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tipos_movimentacao_id_seq OWNER TO postgres;

--
-- TOC entry 6585 (class 0 OID 0)
-- Dependencies: 437
-- Name: tipos_movimentacao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tipos_movimentacao_id_seq OWNED BY public.tipos_movimentacao.id;


--
-- TOC entry 495 (class 1259 OID 4766625)
-- Name: transferencias; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.transferencias (
    id integer NOT NULL,
    id_contagem_origem integer NOT NULL,
    id_contagem_destino integer NOT NULL,
    quantidade integer NOT NULL,
    id_operador integer NOT NULL,
    ean13 character varying(50),
    data_transferencia timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.transferencias OWNER TO postgres;

--
-- TOC entry 494 (class 1259 OID 4766624)
-- Name: transferencias_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.transferencias_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.transferencias_id_seq OWNER TO postgres;

--
-- TOC entry 6587 (class 0 OID 0)
-- Dependencies: 494
-- Name: transferencias_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.transferencias_id_seq OWNED BY public.transferencias.id;


--
-- TOC entry 391 (class 1259 OID 74245)
-- Name: turnos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.turnos (
    nome character varying(1) NOT NULL,
    inicio time without time zone NOT NULL,
    fim time without time zone NOT NULL,
    descricao character varying(100) NOT NULL,
    CONSTRAINT turnos_nome_check CHECK (((nome)::text = ANY ((ARRAY['A'::character varying, 'B'::character varying, 'C'::character varying])::text[])))
);


ALTER TABLE public.turnos OWNER TO postgres;

--
-- TOC entry 461 (class 1259 OID 153682)
-- Name: unidade_conversao; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.unidade_conversao (
    id integer NOT NULL,
    id_unidade_origem integer,
    id_unidade_destino integer,
    fator_conversao numeric(10,4) NOT NULL,
    descricao character varying(200),
    ativo boolean DEFAULT true
);


ALTER TABLE public.unidade_conversao OWNER TO postgres;

--
-- TOC entry 460 (class 1259 OID 153681)
-- Name: unidade_conversao_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.unidade_conversao_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.unidade_conversao_id_seq OWNER TO postgres;

--
-- TOC entry 6589 (class 0 OID 0)
-- Dependencies: 460
-- Name: unidade_conversao_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.unidade_conversao_id_seq OWNED BY public.unidade_conversao.id;


--
-- TOC entry 458 (class 1259 OID 153669)
-- Name: unidades_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.unidades_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.unidades_id_seq OWNER TO postgres;

--
-- TOC entry 6590 (class 0 OID 0)
-- Dependencies: 458
-- Name: unidades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.unidades_id_seq OWNED BY public.unidades.id;


--
-- TOC entry 402 (class 1259 OID 74357)
-- Name: view_pulsos_apontamento; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.view_pulsos_apontamento AS
SELECT
    NULL::integer AS id_apontamento,
    NULL::character varying(200) AS maquina,
    NULL::character varying(100) AS operador,
    NULL::bigint AS total_pulsos,
    NULL::timestamp without time zone AS data_inicio,
    NULL::timestamp without time zone AS data_fim;


ALTER VIEW public.view_pulsos_apontamento OWNER TO postgres;

--
-- TOC entry 528 (class 1259 OID 15546194)
-- Name: vw_analise_estoque_produto; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_analise_estoque_produto AS
 WITH ultimo_inventario_global AS (
         SELECT inventario.id AS ultimo_id_inventario
           FROM public.inventario
          ORDER BY inventario.id DESC
         LIMIT 1
        ), estoque_ultimo_inventario AS (
         SELECT p_1.id AS produto_id,
            sum(ce.quantidade_pacotes) AS quantidade_estoque_total
           FROM ((public.contagem_estoque ce
             JOIN public.produtos p_1 ON ((ce.id_produto = p_1.id_cache)))
             JOIN ultimo_inventario_global uig ON ((ce.id_inventario = uig.ultimo_id_inventario)))
          WHERE (ce.quantidade_pacotes > (0)::numeric)
          GROUP BY p_1.id
         HAVING (sum(ce.quantidade_pacotes) > (0)::numeric)
        ), demanda_produto AS (
         SELECT si.id_produto,
            sum(
                CASE
                    WHEN ((si.quantidade_solicitada - COALESCE(si.quantidade_separada, (0)::numeric)) < (0)::numeric) THEN (0)::numeric
                    ELSE (si.quantidade_solicitada - COALESCE(si.quantidade_separada, (0)::numeric))
                END) AS falta_separar_total
           FROM public.separacao_itens si
          WHERE (si.quantidade_solicitada > (0)::numeric)
          GROUP BY si.id_produto
        ), carteira_produto AS (
         SELECT p_1.id AS produto_id,
            sum(aw.qt_pedidovenda_item) AS quantidade_carteira
           FROM (public.produtos p_1
             LEFT JOIN public.dblink('dbname=AWORKSDB host=192.168.10.252 user=postgres password=aw2000'::text, '
        SELECT 
            pvi.produtoid,
            pvi.qt_pedidovenda_item
        FROM pedidovenda pv
        INNER JOIN pedidovenda_item pvi ON pv.pedidovendaid = pvi.pedidovendaid
        WHERE pv.empresaid = 1
          AND pv.status_pedidovenda IN (''ABERTO'', ''BLOQUEADO'', ''PARCIAL'')
        '::text) aw(produtoid integer, qt_pedidovenda_item numeric) ON (((p_1.id_cache)::numeric = (aw.produtoid)::numeric)))
          GROUP BY p_1.id
        )
 SELECT p.id AS produto_id,
    p.referencia_produto,
    p.ds_produto,
    gp.nome_grupoproduto,
    sg.nome_subgrupoproduto,
    COALESCE(e.quantidade_estoque_total, (0)::numeric) AS quantidade_estoque,
    COALESCE(c.quantidade_carteira, (0)::numeric) AS quantidade_carteira,
    (COALESCE(e.quantidade_estoque_total, (0)::numeric) - COALESCE(d.falta_separar_total, (0)::numeric)) AS saldo_estoque,
    ((COALESCE(e.quantidade_estoque_total, (0)::numeric) - COALESCE(d.falta_separar_total, (0)::numeric)) - COALESCE(c.quantidade_carteira, (0)::numeric)) AS projecao_estoque
   FROM (((((public.produtos p
     LEFT JOIN estoque_ultimo_inventario e ON ((p.id = e.produto_id)))
     LEFT JOIN demanda_produto d ON ((p.id = d.id_produto)))
     LEFT JOIN carteira_produto c ON ((p.id = c.produto_id)))
     LEFT JOIN public.subgrupoproduto sg ON ((p.subgrupoprodutoid = sg.subgrupoprodutoid)))
     LEFT JOIN public.grupoproduto gp ON ((COALESCE(p.grupoprodutoid, sg.grupoprodutoid) = gp.grupoprodutoid)))
  ORDER BY p.referencia_produto;


ALTER VIEW public.vw_analise_estoque_produto OWNER TO postgres;

--
-- TOC entry 504 (class 1259 OID 9861906)
-- Name: vw_pedidos_despacho_completo; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_pedidos_despacho_completo AS
 SELECT mv.id,
    mv.nr_nota_pedidovenda,
    mv.dt_faturamento_pedidovenda,
    mv.dt_entdesejada_pedidovenda,
    mv.cliente_nome,
    mv.cidade,
    mv.uf,
    mv.valor_total,
    mv.peso_bruto,
    mv.peso_liquido,
    mv.volumes,
    mv.filialid,
    mv.observacoes,
    mv.status_pedido,
    mv.data_despacho_prevista,
    mv.status_despacho,
    pdp.data_despacho_prevista AS data_despacho_prevista_atualizada,
    pdp.usuario_id,
    pdp.data_atualizacao,
        CASE
            WHEN (pdp.data_despacho_prevista IS NOT NULL) THEN
            CASE
                WHEN (CURRENT_DATE < (pdp.data_despacho_prevista)::date) THEN 'VERDE'::text
                WHEN (CURRENT_DATE = (pdp.data_despacho_prevista)::date) THEN 'AMARELO'::text
                WHEN (CURRENT_DATE = ((pdp.data_despacho_prevista)::date + 1)) THEN 'LARANJA'::text
                ELSE 'VERMELHO'::text
            END
            ELSE 'ROXO'::text
        END AS prioridade,
        CASE
            WHEN (pdp.data_despacho_prevista IS NOT NULL) THEN (CURRENT_DATE - (pdp.data_despacho_prevista)::date)
            ELSE NULL::integer
        END AS dias_diferenca
   FROM (public.pedidos_prontos_despacho_mv mv
     LEFT JOIN public.pedidos_despacho_previsto pdp ON ((mv.id = pdp.pedidovendaid)));


ALTER VIEW public.vw_pedidos_despacho_completo OWNER TO postgres;

--
-- TOC entry 543 (class 1259 OID 16709339)
-- Name: vw_analise_separacao; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_analise_separacao AS
 WITH ultimo_inventario AS (
         SELECT COALESCE(( SELECT inventario.id
                   FROM public.inventario
                  WHERE ((inventario.status)::text = 'fechado'::text)
                  ORDER BY inventario.id DESC
                 LIMIT 1), ( SELECT inventario.id
                   FROM public.inventario
                  ORDER BY inventario.id DESC
                 LIMIT 1)) AS id
        ), estoque_atual AS (
         SELECT ce.id_produto,
            sum(ce.quantidade_pacotes) AS quantidade_estoque
           FROM (public.contagem_estoque ce
             CROSS JOIN ultimo_inventario ui)
          WHERE ((ce.id_inventario = ui.id) AND (ce.quantidade_pacotes > (0)::numeric))
          GROUP BY ce.id_produto
        ), itens_pedido AS (
         SELECT pi.pedidovendaid,
            pi.pedidovendaitemid,
            pi.produtoid,
            pi.ds_produto,
            pi.referencia,
            pi.quantidade_entrega,
            COALESCE(pi.quantidade_despachada, (0)::numeric) AS quantidade_despachada,
            COALESCE(sum(si.quantidade_separada), (0)::numeric) AS quantidade_separada,
            COALESCE(sum(si.quantidade_conferida), (0)::numeric) AS quantidade_conferida,
            max(
                CASE
                    WHEN (si.bloqueado_por IS NOT NULL) THEN 1
                    ELSE 0
                END) AS bloqueado
           FROM (public.pedido_itens_aworks_simples_mv pi
             LEFT JOIN public.separacao_itens si ON ((si.pedidovendaitemid = pi.pedidovendaitemid)))
          WHERE (COALESCE(pi.quantidade_despachada, (0)::numeric) < pi.quantidade_entrega)
          GROUP BY pi.pedidovendaid, pi.pedidovendaitemid, pi.produtoid, pi.ds_produto, pi.referencia, pi.quantidade_entrega, pi.quantidade_despachada
        ), dados_completos AS (
         SELECT ip.pedidovendaid,
            vw.nr_nota_pedidovenda AS nr_nota_fiscal,
            vw.cliente_nome,
            ip.pedidovendaitemid,
            ip.produtoid,
            ip.ds_produto AS produto_descricao,
            ip.referencia AS produto_referencia,
            ip.quantidade_entrega AS quantidade_solicitada,
            ip.quantidade_separada,
            ip.quantidade_conferida,
            ip.quantidade_despachada,
            (ip.quantidade_entrega - ip.quantidade_separada) AS falta_separar,
            (ip.quantidade_entrega - ip.quantidade_despachada) AS falta_despachar,
            COALESCE(ea.quantidade_estoque, (0)::numeric) AS quantidade_estoque,
            vw.prioridade,
            vw.status_pedido AS status_pedidovenda,
            vw.dt_faturamento_pedidovenda AS data_faturamento,
            vw.cidade,
            vw.uf,
            ip.bloqueado,
                CASE
                    WHEN (ip.quantidade_separada >= ip.quantidade_entrega) THEN 'SEPARADO'::text
                    WHEN (ip.quantidade_separada > (0)::numeric) THEN 'PARCIAL'::text
                    WHEN (ip.bloqueado = 1) THEN 'BLOQUEADO'::text
                    ELSE 'PENDENTE'::text
                END AS status_separacao,
                CASE
                    WHEN (ip.quantidade_despachada >= ip.quantidade_entrega) THEN 'DESPACHADO'::text
                    WHEN (ip.quantidade_despachada > (0)::numeric) THEN 'DESPACHO_PARCIAL'::text
                    ELSE 'AGUARDANDO_DESPACHO'::text
                END AS status_despacho,
                CASE
                    WHEN (ea.quantidade_estoque IS NULL) THEN 'SEM_CADASTRO_LOCAL'::text
                    WHEN (ea.quantidade_estoque >= (ip.quantidade_entrega - ip.quantidade_separada)) THEN 'ESTOQUE_OK'::text
                    WHEN (ea.quantidade_estoque > (0)::numeric) THEN 'ESTOQUE_PARCIAL'::text
                    ELSE 'SEM_ESTOQUE'::text
                END AS status_estoque,
                CASE
                    WHEN ((ip.quantidade_separada < ip.quantidade_despachada) AND (ip.quantidade_despachada > (0)::numeric)) THEN true
                    ELSE false
                END AS divergente,
                CASE
                    WHEN ((ip.quantidade_separada < ip.quantidade_despachada) AND (ip.quantidade_despachada > (0)::numeric)) THEN (ip.quantidade_despachada - ip.quantidade_separada)
                    ELSE (0)::numeric
                END AS divergencia
           FROM ((itens_pedido ip
             LEFT JOIN public.vw_pedidos_despacho_completo vw ON ((vw.id = ip.pedidovendaid)))
             LEFT JOIN estoque_atual ea ON ((ea.id_produto = ip.produtoid)))
        )
 SELECT pedidovendaid,
    nr_nota_fiscal,
    cliente_nome,
    pedidovendaitemid,
    produtoid,
    produto_descricao,
    produto_referencia,
    quantidade_solicitada,
    quantidade_separada,
    quantidade_conferida,
    quantidade_despachada,
    falta_separar,
    falta_despachar,
    quantidade_estoque,
    prioridade,
    status_pedidovenda,
    data_faturamento,
    cidade,
    uf,
    bloqueado,
    status_separacao,
    status_despacho,
    status_estoque,
    divergente,
    divergencia
   FROM dados_completos;


ALTER VIEW public.vw_analise_separacao OWNER TO postgres;

--
-- TOC entry 546 (class 1259 OID 16713229)
-- Name: vw_analise_separacao_mv; Type: MATERIALIZED VIEW; Schema: public; Owner: postgres
--

CREATE MATERIALIZED VIEW public.vw_analise_separacao_mv AS
 WITH ultimo_inventario AS (
         SELECT COALESCE(( SELECT inventario.id
                   FROM public.inventario
                  WHERE ((inventario.status)::text = 'fechado'::text)
                  ORDER BY inventario.id DESC
                 LIMIT 1), ( SELECT inventario.id
                   FROM public.inventario
                  ORDER BY inventario.id DESC
                 LIMIT 1)) AS id
        ), estoque_atual AS (
         SELECT ce.id_produto,
            sum(ce.quantidade_pacotes) AS quantidade_estoque
           FROM (public.contagem_estoque ce
             CROSS JOIN ultimo_inventario ui)
          WHERE ((ce.id_inventario = ui.id) AND (ce.quantidade_pacotes > (0)::numeric))
          GROUP BY ce.id_produto
        ), itens_pedido AS (
         SELECT pi.pedidovendaid,
            pi.pedidovendaitemid,
            pi.produtoid,
            pi.ds_produto,
            pi.referencia,
            pi.quantidade_entrega,
            COALESCE(pi.quantidade_despachada, (0)::numeric) AS quantidade_despachada,
            COALESCE(sum(si.quantidade_separada), (0)::numeric) AS quantidade_separada,
            COALESCE(sum(si.quantidade_conferida), (0)::numeric) AS quantidade_conferida,
            max(
                CASE
                    WHEN (si.bloqueado_por IS NOT NULL) THEN 1
                    ELSE 0
                END) AS bloqueado
           FROM (public.pedido_itens_aworks_simples_mv pi
             LEFT JOIN public.separacao_itens si ON ((si.pedidovendaitemid = pi.pedidovendaitemid)))
          WHERE (COALESCE(pi.quantidade_despachada, (0)::numeric) < pi.quantidade_entrega)
          GROUP BY pi.pedidovendaid, pi.pedidovendaitemid, pi.produtoid, pi.ds_produto, pi.referencia, pi.quantidade_entrega, pi.quantidade_despachada
        ), dados_completos AS (
         SELECT ip.pedidovendaid,
            vw.nr_nota_pedidovenda AS nr_nota_fiscal,
            vw.cliente_nome,
            ip.pedidovendaitemid,
            ip.produtoid,
            ip.ds_produto AS produto_descricao,
            ip.referencia AS produto_referencia,
            ip.quantidade_entrega AS quantidade_solicitada,
            ip.quantidade_separada,
            ip.quantidade_conferida,
            ip.quantidade_despachada,
            (ip.quantidade_entrega - ip.quantidade_separada) AS falta_separar,
            (ip.quantidade_entrega - ip.quantidade_despachada) AS falta_despachar,
            COALESCE(ea.quantidade_estoque, (0)::numeric) AS quantidade_estoque,
            vw.prioridade,
            vw.status_pedido AS status_pedidovenda,
            vw.dt_faturamento_pedidovenda AS data_faturamento,
            vw.cidade,
            vw.uf,
            ip.bloqueado,
                CASE
                    WHEN (ip.quantidade_separada >= ip.quantidade_entrega) THEN 'SEPARADO'::text
                    WHEN (ip.quantidade_separada > (0)::numeric) THEN 'PARCIAL'::text
                    WHEN (ip.bloqueado = 1) THEN 'BLOQUEADO'::text
                    ELSE 'PENDENTE'::text
                END AS status_separacao,
                CASE
                    WHEN (ip.quantidade_despachada >= ip.quantidade_entrega) THEN 'DESPACHADO'::text
                    WHEN (ip.quantidade_despachada > (0)::numeric) THEN 'DESPACHO_PARCIAL'::text
                    ELSE 'AGUARDANDO_DESPACHO'::text
                END AS status_despacho,
                CASE
                    WHEN (ea.quantidade_estoque IS NULL) THEN 'SEM_CADASTRO_LOCAL'::text
                    WHEN (ea.quantidade_estoque >= (ip.quantidade_entrega - ip.quantidade_separada)) THEN 'ESTOQUE_OK'::text
                    WHEN (ea.quantidade_estoque > (0)::numeric) THEN 'ESTOQUE_PARCIAL'::text
                    ELSE 'SEM_ESTOQUE'::text
                END AS status_estoque,
                CASE
                    WHEN ((ip.quantidade_separada < ip.quantidade_despachada) AND (ip.quantidade_despachada > (0)::numeric)) THEN true
                    ELSE false
                END AS divergente,
                CASE
                    WHEN ((ip.quantidade_separada < ip.quantidade_despachada) AND (ip.quantidade_despachada > (0)::numeric)) THEN (ip.quantidade_despachada - ip.quantidade_separada)
                    ELSE (0)::numeric
                END AS divergencia
           FROM ((itens_pedido ip
             LEFT JOIN public.vw_pedidos_despacho_completo vw ON ((vw.id = ip.pedidovendaid)))
             LEFT JOIN estoque_atual ea ON ((ea.id_produto = ip.produtoid)))
        )
 SELECT pedidovendaid,
    nr_nota_fiscal,
    cliente_nome,
    pedidovendaitemid,
    produtoid,
    produto_descricao,
    produto_referencia,
    quantidade_solicitada,
    quantidade_separada,
    quantidade_conferida,
    quantidade_despachada,
    falta_separar,
    falta_despachar,
    quantidade_estoque,
    prioridade,
    status_pedidovenda,
    data_faturamento,
    cidade,
    uf,
    bloqueado,
    status_separacao,
    status_despacho,
    status_estoque,
    divergente,
    divergencia
   FROM dados_completos
  WITH NO DATA;


ALTER MATERIALIZED VIEW public.vw_analise_separacao_mv OWNER TO postgres;

--
-- TOC entry 396 (class 1259 OID 74308)
-- Name: vw_calendario_manutencoes; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_calendario_manutencoes AS
 SELECT p.id,
    p.id_maquina,
    m.descricao AS maquina_descricao,
    p.data_inicio,
    p.data_fim,
    p.tipo,
    p.descricao,
    p.motivo,
    p.status,
    tm.descricao AS tipo_manutencao,
    tm.categoria,
    o.nome AS operador_responsavel
   FROM ((((public.planejamento_producao p
     JOIN public.maquinas m ON ((p.id_maquina = m.id)))
     LEFT JOIN public.historico_manutencoes hm ON ((p.id = hm.id_planejamento)))
     LEFT JOIN public.tipos_manutencao tm ON ((hm.id_tipo_manutencao = tm.id)))
     LEFT JOIN public.operadores o ON ((hm.id_operador_responsavel = o.id)))
  WHERE ((p.tipo)::text = ANY ((ARRAY['manutencao'::character varying, 'troca_molde'::character varying])::text[]));


ALTER VIEW public.vw_calendario_manutencoes OWNER TO postgres;

--
-- TOC entry 538 (class 1259 OID 16424353)
-- Name: vw_dashboard_compras; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_dashboard_compras AS
 SELECT count(*) FILTER (WHERE ((status)::text = 'PENDENTE'::text)) AS pendentes,
    count(*) FILTER (WHERE ((status)::text = 'ANALISE'::text)) AS em_analise,
    count(*) FILTER (WHERE ((status)::text = 'EM_COMPRA'::text)) AS em_compra,
    count(*) FILTER (WHERE ((status)::text = 'COMPRADA'::text)) AS compradas,
    count(*) FILTER (WHERE ((status)::text = 'CANCELADA'::text)) AS canceladas,
    sum(quantidade_solicitada) FILTER (WHERE ((status)::text = ANY ((ARRAY['PENDENTE'::character varying, 'ANALISE'::character varying, 'EM_COMPRA'::character varying])::text[]))) AS quantidade_total_pendente,
    count(DISTINCT id_produto) FILTER (WHERE ((status)::text = ANY ((ARRAY['PENDENTE'::character varying, 'ANALISE'::character varying, 'EM_COMPRA'::character varying])::text[]))) AS produtos_ativos
   FROM public.requisicao_compra;


ALTER VIEW public.vw_dashboard_compras OWNER TO postgres;

--
-- TOC entry 521 (class 1259 OID 15122798)
-- Name: vw_despacho_real; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_despacho_real AS
 SELECT pedidovendaitemid,
    pedidovendaid,
    produtoid,
    dt_despacho AS data_despacho,
    qt_despacho AS quantidade_despachada
   FROM public.dblink('hostaddr=192.168.10.252 port=5432 dbname=AWORKSDB user=postgres password=aw2000'::text, '
    SELECT 
        pvi.pedidovendaitemid,
        pvi.pedidovendaid,
        pvi.produtoid,
        pvi.dt_despacho,
        pvi.qt_despacho
    FROM pedidovenda_item pvi
    WHERE pvi.dt_despacho IS NOT NULL
      AND pvi.qt_despacho > 0
    '::text) t(pedidovendaitemid integer, pedidovendaid integer, produtoid integer, dt_despacho timestamp without time zone, qt_despacho numeric);


ALTER VIEW public.vw_despacho_real OWNER TO postgres;

--
-- TOC entry 6596 (class 0 OID 0)
-- Dependencies: 521
-- Name: VIEW vw_despacho_real; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.vw_despacho_real IS 'Datas reais de despacho dos itens do AWORKS';


--
-- TOC entry 397 (class 1259 OID 74313)
-- Name: vw_disponibilidade_maquinas; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_disponibilidade_maquinas AS
 SELECT id,
    descricao,
    tipo_maquina,
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM public.planejamento_producao pp
              WHERE ((pp.id_maquina = m.id) AND ((pp.status)::text = ANY ((ARRAY['em_andamento'::character varying, 'planejado'::character varying])::text[])) AND (pp.data_fim > now())))) THEN 'ocupada'::text
            ELSE 'disponivel'::text
        END AS status,
    ( SELECT max(pp.data_fim) AS max
           FROM public.planejamento_producao pp
          WHERE ((pp.id_maquina = m.id) AND (pp.data_fim > now()))) AS proxima_disponibilidade
   FROM public.maquinas m
  WHERE (ativo = true);


ALTER VIEW public.vw_disponibilidade_maquinas OWNER TO postgres;

--
-- TOC entry 549 (class 1259 OID 16900893)
-- Name: vw_divergencias_pendentes; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_divergencias_pendentes AS
 WITH itens_separacao_unicos AS (
         SELECT DISTINCT ON (si_1.pedidovendaitemid) si_1.id_separacao_pedido,
            si_1.pedidovendaitemid,
            si_1.id_produto,
            si_1.quantidade_solicitada,
            si_1.quantidade_separada,
            si_1.quantidade_conferida,
            si_1.status,
            si_1.referencia,
            si_1.created_at,
            si_1.data_separacao,
                CASE
                    WHEN (si_1.quantidade_separada > (0)::numeric) THEN 0
                    ELSE 1
                END AS prioridade_separacao
           FROM public.separacao_itens si_1
          WHERE (si_1.quantidade_solicitada > (0)::numeric)
          ORDER BY si_1.pedidovendaitemid,
                CASE
                    WHEN (si_1.quantidade_separada > (0)::numeric) THEN 0
                    ELSE 1
                END, si_1.data_separacao DESC NULLS LAST, si_1.created_at DESC, si_1.id DESC
        )
 SELECT sp.pedidovendaid,
    sp.nr_nota_fiscal,
    sp.cliente_nome,
    si.pedidovendaitemid,
    COALESCE(si.referencia, p.referencia_produto, 'SEM REFERÊNCIA'::character varying) AS produto_referencia,
    COALESCE(p.ds_produto, si.referencia, 'SEM DESCRIÇÃO'::character varying) AS produto_descricao,
    COALESCE(si.quantidade_solicitada, (0)::numeric) AS quantidade_solicitada,
    COALESCE(si.quantidade_separada, (0)::numeric) AS quantidade_separada,
    COALESCE(pi.quantidade_despachada, (0)::numeric) AS quantidade_despachada,
    (COALESCE(pi.quantidade_despachada, (0)::numeric) - COALESCE(si.quantidade_separada, (0)::numeric)) AS divergencia,
    now() AS data_detecao,
    'PENDENTE'::text AS status,
        CASE
            WHEN ((COALESCE(pi.quantidade_despachada, (0)::numeric) - COALESCE(si.quantidade_separada, (0)::numeric)) > (100)::numeric) THEN 'CRITICA'::text
            WHEN ((COALESCE(pi.quantidade_despachada, (0)::numeric) - COALESCE(si.quantidade_separada, (0)::numeric)) > (50)::numeric) THEN 'ALTA'::text
            WHEN ((COALESCE(pi.quantidade_despachada, (0)::numeric) - COALESCE(si.quantidade_separada, (0)::numeric)) > (10)::numeric) THEN 'MEDIA'::text
            ELSE 'BAIXA'::text
        END AS gravidade,
    sp.status AS status_pedido,
    sp.data_inicio_separacao,
    sp.data_fim_separacao,
    sp.created_at AS data_criacao_pedido
   FROM (((public.separacao_pedidos sp
     JOIN itens_separacao_unicos si ON ((si.id_separacao_pedido = sp.id)))
     LEFT JOIN public.produtos p ON ((p.id = si.id_produto)))
     LEFT JOIN public.pedido_itens_aworks_simples_mv pi ON ((pi.pedidovendaitemid = si.pedidovendaitemid)))
  WHERE ((COALESCE(pi.quantidade_despachada, (0)::numeric) > (0)::numeric) AND (COALESCE(pi.quantidade_despachada, (0)::numeric) > COALESCE(si.quantidade_separada, (0)::numeric)) AND (date(sp.created_at) >= (CURRENT_DATE - 1)))
  ORDER BY (COALESCE(pi.quantidade_despachada, (0)::numeric) - COALESCE(si.quantidade_separada, (0)::numeric)) DESC;


ALTER VIEW public.vw_divergencias_pendentes OWNER TO postgres;

--
-- TOC entry 550 (class 1259 OID 16900982)
-- Name: vw_divergencias_pendentes_dashboard; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_divergencias_pendentes_dashboard AS
 SELECT id,
    pedidovendaid,
    nr_nota_fiscal,
    cliente_nome,
    pedidovendaitemid,
    produto_descricao,
    produto_referencia,
    quantidade_solicitada,
    quantidade_separada,
    quantidade_despachada,
    divergencia,
    data_detecao,
    status,
    data_resolucao,
    resolvido_por,
    observacoes,
    round((EXTRACT(epoch FROM (now() - (data_detecao)::timestamp with time zone)) / (60)::numeric), 2) AS tempo_pendente_minutos,
        CASE
            WHEN (divergencia > (100)::numeric) THEN 'CRITICA'::text
            WHEN (divergencia > (50)::numeric) THEN 'ALTA'::text
            WHEN (divergencia > (10)::numeric) THEN 'MEDIA'::text
            ELSE 'BAIXA'::text
        END AS gravidade
   FROM public.divergencias_estoque d
  WHERE (((status)::text = 'PENDENTE'::text) AND (date(data_detecao) >= (CURRENT_DATE - 1)))
  ORDER BY divergencia DESC, data_detecao DESC;


ALTER VIEW public.vw_divergencias_pendentes_dashboard OWNER TO postgres;

--
-- TOC entry 507 (class 1259 OID 10576082)
-- Name: vw_entradas_producao_aworks; Type: MATERIALIZED VIEW; Schema: public; Owner: postgres
--

CREATE MATERIALIZED VIEW public.vw_entradas_producao_aworks AS
 SELECT k.kardexid,
    k.produtoid,
    (floor(k.qt_kardex))::integer AS qt_kardex,
    k.tipo_kardex,
    k.usuarioid,
    k.dt_kardex,
    p.referencia_produto,
    p.ds_produto,
    op.nome AS operador_nome
   FROM ((public.dblink('hostaddr=192.168.10.252 port=5432 dbname=AWORKSDB user=postgres password=aw2000'::text, 'SELECT kardexid::integer,
          produtoid::integer,
          qt_kardex::numeric,
          tipo_kerdex::text,
          usuarioid::integer,
          dt_kardex::timestamptz
   FROM kardex
   WHERE (tipo_kerdex = ''ENTRADA'' OR tipo_kerdex = ''SAIDA'')
     AND usuarioid IN (140, 141, 142, 143, 144, 145, 146, 148, 149, 150, 151, 152)
     AND dt_kardex >= NOW() - INTERVAL ''240 hours''
   ORDER BY dt_kardex DESC'::text) k(kardexid integer, produtoid integer, qt_kardex numeric, tipo_kardex text, usuarioid integer, dt_kardex timestamp with time zone)
     LEFT JOIN public.produtos p ON ((k.produtoid = p.id_cache)))
     LEFT JOIN public.operadores op ON ((k.usuarioid = op.id)))
  WHERE (k.dt_kardex >= COALESCE((( SELECT controle_entrada_producao.valor_timestamp
           FROM public.controle_entrada_producao
          WHERE ((controle_entrada_producao.chave)::text = 'cutoff_backlog_aworks'::text)))::timestamp with time zone, (now() - '240:00:00'::interval)))
  WITH NO DATA;


ALTER MATERIALIZED VIEW public.vw_entradas_producao_aworks OWNER TO postgres;

--
-- TOC entry 510 (class 1259 OID 11428097)
-- Name: vw_estoque_auditoria_detalhada; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_estoque_auditoria_detalhada AS
 SELECT e.id,
    e.data_evento,
    e.operacao,
    e.origem_modulo,
    e.origem_tipo,
    e.referencia_movimento,
    e.id_referencia,
    e.id_produto,
    pc.referencia AS produto_referencia,
    pc.descricao AS produto_descricao,
    e.id_posicao,
    concat(COALESCE(r.codigo, 'CH'::character varying), '-', COALESCE(m.codigo, 'CH'::character varying), '-', COALESCE(n.codigo, 'CH'::character varying), '-', p.codigo) AS posicao_codigo,
    e.quantidade_anterior,
    e.quantidade_atual,
    e.delta_quantidade,
    e.id_operador,
    op.nome AS operador_nome,
    e.observacao,
    e.txid
   FROM ((((((public.estoque_auditoria_eventos e
     LEFT JOIN public.produtos_cache pc ON ((pc.id = e.id_produto)))
     LEFT JOIN public.operadores op ON ((op.id = e.id_operador)))
     LEFT JOIN public.posicoes p ON ((p.id = e.id_posicao)))
     LEFT JOIN public.niveis n ON ((n.id = p.id_nivel)))
     LEFT JOIN public.modulos m ON ((m.id = n.id_modulo)))
     LEFT JOIN public.ruas r ON ((r.id = m.id_rua)));


ALTER VIEW public.vw_estoque_auditoria_detalhada OWNER TO postgres;

--
-- TOC entry 509 (class 1259 OID 11428092)
-- Name: vw_estoque_completo; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_estoque_completo AS
 SELECT e.id,
    e.produto_id,
    e.posicao_id,
    e.quantidade,
    e.data_atualizacao,
    e.operador_id,
    p.id AS produto_id_original,
    p.referencia_produto,
    p.ds_produto,
    p.id_cache AS produto_id_cache,
    pc.descricao AS produto_descricao_cache,
    pc.tp_produto AS produto_tp_cache,
    po.codigo AS posicao_codigo
   FROM (((public.estoque e
     JOIN public.produtos p ON ((e.produto_id = p.id)))
     LEFT JOIN public.produtos_cache pc ON ((p.id_cache = pc.id)))
     JOIN public.posicoes po ON ((e.posicao_id = po.id)));


ALTER VIEW public.vw_estoque_completo OWNER TO postgres;

--
-- TOC entry 542 (class 1259 OID 16648118)
-- Name: vw_estoque_consolidado; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_estoque_consolidado AS
 WITH ultimo_inventario_global AS (
         SELECT COALESCE(( SELECT inventario.id
                   FROM public.inventario
                  WHERE ((inventario.status)::text = 'fechado'::text)
                  ORDER BY inventario.id DESC
                 LIMIT 1), ( SELECT inventario.id
                   FROM public.inventario
                  ORDER BY inventario.id DESC
                 LIMIT 1)) AS ultimo_id_inventario
        ), estoque_ultimo_inventario AS (
         SELECT ce.id_produto,
            sum(ce.quantidade_pacotes) AS quantidade_estoque_total,
            max(ce.id_inventario) AS id_inventario
           FROM (public.contagem_estoque ce
             CROSS JOIN ultimo_inventario_global uig)
          WHERE ((ce.id_inventario = uig.ultimo_id_inventario) AND (ce.quantidade_pacotes > (0)::numeric))
          GROUP BY ce.id_produto
         HAVING (sum(ce.quantidade_pacotes) > (0)::numeric)
        )
 SELECT p.id AS produto_id,
    COALESCE(e.quantidade_estoque_total, (0)::numeric) AS quantidade_estoque_total,
    e.id_inventario,
    p.id_cache AS produto_id_cache
   FROM (public.produtos p
     LEFT JOIN estoque_ultimo_inventario e ON ((e.id_produto = p.id_cache)))
  GROUP BY p.id, e.quantidade_estoque_total, e.id_inventario, p.id_cache;


ALTER VIEW public.vw_estoque_consolidado OWNER TO postgres;

--
-- TOC entry 6603 (class 0 OID 0)
-- Dependencies: 542
-- Name: VIEW vw_estoque_consolidado; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.vw_estoque_consolidado IS 'Estoque consolidado usando id_cache da contagem_estoque com id da tabela produtos';


--
-- TOC entry 522 (class 1259 OID 15127410)
-- Name: vw_estoque_simples; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_estoque_simples AS
 SELECT p.id AS produto_id,
    p.referencia_produto,
    p.ds_produto,
    sum(e.quantidade) AS estoque_total
   FROM (public.estoque e
     JOIN public.produtos p ON ((e.produto_id = p.id)))
  GROUP BY p.id, p.referencia_produto, p.ds_produto
 HAVING (sum(e.quantidade) > (0)::numeric)
  ORDER BY p.referencia_produto;


ALTER VIEW public.vw_estoque_simples OWNER TO postgres;

--
-- TOC entry 6605 (class 0 OID 0)
-- Dependencies: 522
-- Name: VIEW vw_estoque_simples; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.vw_estoque_simples IS 'View simples com estoque consolidado por produto';


--
-- TOC entry 539 (class 1259 OID 16424358)
-- Name: vw_materiais_criticos; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_materiais_criticos AS
 SELECT p.id,
    p.referencia_produto,
    p.ds_produto,
    COALESCE(sum(ce.quantidade_pacotes), (0)::numeric) AS estoque_atual,
    p.estoque_minimo,
    (COALESCE(p.estoque_minimo, (0)::numeric) - COALESCE(sum(ce.quantidade_pacotes), (0)::numeric)) AS deficit,
    (EXISTS ( SELECT 1
           FROM public.requisicao_compra rc
          WHERE ((rc.id_produto = p.id) AND ((rc.status)::text <> ALL ((ARRAY['CANCELADA'::character varying, 'COMPRADA'::character varying])::text[]))))) AS tem_requisicao
   FROM (public.produtos p
     LEFT JOIN public.contagem_estoque ce ON ((p.id_cache = ce.id_produto)))
  WHERE (((p.tp_produto)::text = 'MATPRIMA'::text) AND (COALESCE(p.ativo, true) = true))
  GROUP BY p.id, p.referencia_produto, p.ds_produto, p.estoque_minimo
 HAVING (COALESCE(sum(ce.quantidade_pacotes), (0)::numeric) < COALESCE(p.estoque_minimo, (0)::numeric))
  ORDER BY (COALESCE(p.estoque_minimo, (0)::numeric) - COALESCE(sum(ce.quantidade_pacotes), (0)::numeric)) DESC;


ALTER VIEW public.vw_materiais_criticos OWNER TO postgres;

--
-- TOC entry 455 (class 1259 OID 125375)
-- Name: vw_ocupacao_chao; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_ocupacao_chao AS
 SELECT m.codigo AS local,
    n.codigo AS zona,
    count(e.id) AS palets_ocupados,
    count(p.id) AS capacidade_total,
    round((((count(e.id))::numeric * 100.0) / (count(p.id))::numeric), 2) AS percentual_ocupado
   FROM (((public.modulos m
     JOIN public.niveis n ON ((n.id_modulo = m.id)))
     JOIN public.posicoes p ON ((p.id_nivel = n.id)))
     LEFT JOIN public.estoque e ON ((e.posicao_id = p.id)))
  WHERE ((m.codigo)::text ~~ 'CH%'::text)
  GROUP BY m.codigo, n.codigo
  ORDER BY m.codigo, n.codigo;


ALTER VIEW public.vw_ocupacao_chao OWNER TO postgres;

--
-- TOC entry 453 (class 1259 OID 105066)
-- Name: vw_oee_historico; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_oee_historico AS
 SELECT oc.id AS oee_id,
    oc.id_maquina,
    oc.id_produto,
    oc.id_apontamento,
    oc.data_calculo,
    oc.periodo_inicio,
    oc.periodo_fim,
    oc.disponibilidade,
    oc.performance,
    oc.qualidade,
    oc.oee,
    oc.tempo_total_segundos,
    oc.tempo_paradas_segundos,
    oc.tempo_producao_segundos,
    oc.pecas_produzidas,
    oc.pecas_boas,
    oc.pecas_defeituosas,
    oc.velocidade_ideal_pecas_hora,
    oc.velocidade_real_pecas_hora,
    oc.meta_atingida,
    maq.descricao AS maquina,
    maq.tipo_maquina,
    prod.ds_produto,
    prod.referencia_produto,
        CASE
            WHEN (oc.oee >= (85)::numeric) THEN 'EXCELENTE'::text
            WHEN (oc.oee >= (70)::numeric) THEN 'BOM'::text
            WHEN (oc.oee >= (60)::numeric) THEN 'REGULAR'::text
            ELSE 'CRÍTICO'::text
        END AS classificacao_oee
   FROM ((public.oee_calculado oc
     JOIN public.maquinas maq ON ((oc.id_maquina = maq.id)))
     LEFT JOIN public.produtos prod ON ((oc.id_produto = prod.id)))
  ORDER BY oc.data_calculo DESC;


ALTER VIEW public.vw_oee_historico OWNER TO postgres;

--
-- TOC entry 452 (class 1259 OID 105061)
-- Name: vw_oee_tempo_real; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_oee_tempo_real AS
 SELECT maq.id AS id_maquina,
    maq.descricao AS maquina,
    maq.tipo_maquina,
    ap.id AS id_apontamento,
    ap.status,
    prod.id AS id_produto,
    prod.ds_produto AS produto,
    prod.tempo_padrao_montagem_segundos,
    prod.tempo_padrao_embalagem_segundos,
    prod.tempo_padrao_injecao_segundos,
    prod.meta_horaria_montagem,
    prod.meta_horaria_embalagem,
    prod.meta_horaria_injecao,
    ap.quantidade_pecas,
    ap.pecas_boas,
    ap.data_inicio,
    EXTRACT(epoch FROM (now() - (ap.data_inicio)::timestamp with time zone)) AS tempo_decorrido_segundos,
    oee.disponibilidade AS oee_disponibilidade,
    oee.performance AS oee_performance,
    oee.qualidade AS oee_qualidade,
    oee.oee AS oee_total,
    oee.tempo_total_segundos AS oee_tempo_total,
    oee.tempo_paradas_segundos AS oee_tempo_paradas,
    oee.tempo_producao_segundos AS oee_tempo_producao,
    oee.pecas_produzidas AS oee_pecas_produzidas,
    oee.pecas_boas AS oee_pecas_boas,
    oee.pecas_defeituosas AS oee_pecas_defeituosas,
    oee.velocidade_ideal_pecas_hora AS oee_velocidade_ideal,
    oee.velocidade_real_pecas_hora AS oee_velocidade_real,
    oee.tempo_padrao_segundos AS oee_tempo_padrao,
    oee.meta_horaria AS oee_meta_horaria
   FROM (((public.apontamento_producao ap
     JOIN public.maquinas maq ON ((ap.id_maquina = maq.id)))
     LEFT JOIN public.produtos prod ON ((ap.id_produto = prod.id)))
     CROSS JOIN LATERAL public.calcular_oee_por_produto(ap.id) oee(id_maquina, id_produto, id_apontamento, tipo_maquina, produto_descricao, disponibilidade, performance, qualidade, oee, tempo_total_segundos, tempo_paradas_segundos, tempo_producao_segundos, pecas_produzidas, pecas_boas, pecas_defeituosas, velocidade_ideal_pecas_hora, velocidade_real_pecas_hora, tempo_padrao_segundos, meta_horaria))
  WHERE ((ap.status)::text = 'EM_ANDAMENTO'::text);


ALTER VIEW public.vw_oee_tempo_real OWNER TO postgres;

--
-- TOC entry 493 (class 1259 OID 4508900)
-- Name: vw_palets_chao; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_palets_chao AS
 SELECT e.id,
    e.produto_id,
    p.codigo AS posicao,
    m.codigo AS local,
    n.codigo AS zona,
    e.quantidade,
    e.data_atualizacao,
    age(now(), (e.data_atualizacao)::timestamp with time zone) AS tempo_no_local
   FROM (((public.estoque e
     JOIN public.posicoes p ON ((e.posicao_id = p.id)))
     JOIN public.niveis n ON ((p.id_nivel = n.id)))
     JOIN public.modulos m ON ((n.id_modulo = m.id)))
  WHERE ((m.codigo)::text ~~ 'CH%'::text)
  ORDER BY m.codigo, n.codigo, p.codigo;


ALTER VIEW public.vw_palets_chao OWNER TO postgres;

--
-- TOC entry 482 (class 1259 OID 3236670)
-- Name: vw_pedido_itens_aworks; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_pedido_itens_aworks AS
 SELECT t.pedidovendaitemid,
    t.pedidovendaid,
    p.id AS produtoid_local,
    t.produtoid_aworks AS produtoid_original,
    t.ds_produto,
    t.quantidade_total,
    t.quantidade_entrega,
    t.vl_unitario,
    t.vl_total,
    t.referencia,
    t.almoxarifadoid,
    t.quantidade_despachada
   FROM (public.dblink('dbname=AWORKSDB host=192.168.10.252 user=postgres password=aw2000'::text, 'SELECT 
    pvi.pedidovendaitemid::integer,
    pvi.pedidovendaid::integer,
    pvi.produtoid::integer as produtoid_aworks, -- RENOMEADO AQUI
    pvi.ds_produto_pedidovenda_item::text,
    pvi.qt_pedidovenda_item::numeric as quantidade_total,
    pvi.qt_entrega_pedidovenda_item::numeric as quantidade_entrega,
    pvi.vl_unit_pedidovenda_item::numeric as vl_unitario,
    pvi.vl_total_pedidovenda_item::numeric as vl_total,
    pr.referencia_produto::text,
    pvi.almoxarifadoid::integer,
    COALESCE(pvi.qt_despacho, 0)::numeric as quantidade_despachada
   FROM pedidovenda_item pvi
   LEFT JOIN produto pr ON pvi.produtoid = pr.produtoid
   WHERE pvi.qt_entrega_pedidovenda_item > 0'::text) t(pedidovendaitemid integer, pedidovendaid integer, produtoid_aworks integer, ds_produto text, quantidade_total numeric, quantidade_entrega numeric, vl_unitario numeric, vl_total numeric, referencia text, almoxarifadoid integer, quantidade_despachada numeric)
     LEFT JOIN public.produtos p ON ((t.produtoid_aworks = p.id_original)));


ALTER VIEW public.vw_pedido_itens_aworks OWNER TO postgres;

--
-- TOC entry 524 (class 1259 OID 15131079)
-- Name: vw_pedido_itens_aworks_simples; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_pedido_itens_aworks_simples AS
 SELECT pedidovendaitemid,
    pedidovendaid,
    produtoid,
    ds_produto,
    quantidade_total,
    quantidade_entrega,
    vl_unitario,
    vl_total,
    referencia,
    almoxarifadoid,
    quantidade_despachada
   FROM public.pedido_itens_aworks_simples_mv;


ALTER VIEW public.vw_pedido_itens_aworks_simples OWNER TO postgres;

--
-- TOC entry 6610 (class 0 OID 0)
-- Dependencies: 524
-- Name: VIEW vw_pedido_itens_aworks_simples; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.vw_pedido_itens_aworks_simples IS 'View que aponta para a materialized view pedido_itens_aworks_simples_mv';


--
-- TOC entry 527 (class 1259 OID 15539011)
-- Name: vw_produtos_grupo_subgrupo; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_produtos_grupo_subgrupo AS
 SELECT p.id AS produto_id_local,
    p.id_cache AS produto_id_cache,
    p.referencia_produto,
    p.ds_produto,
    p.ean13,
    p.tp_produto,
    p.vl_pesobruto_produto,
    aw_prod.produtoid,
    aw_prod.nome_produto,
    aw_prod.ds_produto AS ds_produto_aworks,
    aw_prod.referencia_produto AS referencia_aworks,
    aw_prod.status_produto,
    aw_prod.tp_produto AS tp_produto_aworks,
    gp.grupoprodutoid,
    gp.nome_grupoproduto,
    gp.filialid,
    gp.empresaid,
    gp.vl_meta_mensal_grupoproduto,
    sg.subgrupoprodutoid,
    sg.nome_subgrupoproduto,
    sg.bo_ipicusto_subgrupoproduto,
    sg.ifpvid,
    sg.vl_custo_hora_produto,
    sg.vl_meta_mensal_subgrupoproduto,
    sg.bo_verifica_mp_lote
   FROM (((public.produtos p
     LEFT JOIN public.dblink('dbname=AWORKSDB host=192.168.10.252 user=postgres password=aw2000'::text, '
    SELECT 
        produtoid,
        nome_produto,
        ds_produto,
        referencia_produto,
        status_produto,
        tp_produto,
        subgrupoprodutoid
    FROM produto
    WHERE empresaid = 1
      AND status_produto = ''ATIVO''
    '::text) aw_prod(produtoid numeric(15,2), nome_produto character varying(100), ds_produto character varying(100), referencia_produto character varying(30), status_produto character varying(30), tp_produto character varying(10), subgrupoprodutoid numeric(8,0)) ON (((p.id_cache)::numeric = aw_prod.produtoid)))
     LEFT JOIN public.subgrupoproduto sg ON ((COALESCE(p.subgrupoprodutoid, aw_prod.subgrupoprodutoid) = sg.subgrupoprodutoid)))
     LEFT JOIN public.grupoproduto gp ON ((COALESCE(p.grupoprodutoid, sg.grupoprodutoid) = gp.grupoprodutoid)))
  WHERE ((p.id_cache IS NOT NULL) AND (p.id_cache > 0))
  ORDER BY p.referencia_produto;


ALTER VIEW public.vw_produtos_grupo_subgrupo OWNER TO postgres;

--
-- TOC entry 6612 (class 0 OID 0)
-- Dependencies: 527
-- Name: VIEW vw_produtos_grupo_subgrupo; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON VIEW public.vw_produtos_grupo_subgrupo IS 'View que vincula produtos locais com grupo/subgrupo do AWORKS via id_cache';


--
-- TOC entry 537 (class 1259 OID 16424348)
-- Name: vw_requisicoes_compra_pendentes; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_requisicoes_compra_pendentes AS
 SELECT rc.id,
    rc.numero_requisicao,
    rc.id_produto,
    p.referencia_produto,
    p.ds_produto,
    rc.quantidade_solicitada,
    rc.unidade,
    to_char((rc.data_necessidade)::timestamp with time zone, 'DD/MM/YYYY'::text) AS data_necessidade_formatada,
    rc.data_necessidade,
    rc.status,
        CASE rc.status
            WHEN 'PENDENTE'::text THEN 'Aguardando'::character varying
            WHEN 'ANALISE'::text THEN 'Em Analise'::character varying
            WHEN 'EM_COMPRA'::text THEN 'Em Compra'::character varying
            WHEN 'COMPRADA'::text THEN 'Comprada'::character varying
            ELSE rc.status
        END AS status_descricao,
    COALESCE(sum(ce.quantidade_pacotes), (0)::numeric) AS estoque_atual,
    p.estoque_minimo,
    p.ponto_pedido,
    p.lead_time_compra_dias,
    p.lote_compra,
    rc.numero_oc_aworks,
    rc.observacoes,
    rc.created_at,
    EXTRACT(day FROM (now() - (rc.created_at)::timestamp with time zone)) AS dias_pendente,
        CASE
            WHEN (COALESCE(sum(ce.quantidade_pacotes), (0)::numeric) < COALESCE(p.estoque_minimo, (0)::numeric)) THEN 'CRITICO'::text
            WHEN (COALESCE(sum(ce.quantidade_pacotes), (0)::numeric) < COALESCE(p.ponto_pedido, (0)::numeric)) THEN 'URGENTE'::text
            WHEN (rc.data_necessidade <= (CURRENT_DATE + 5)) THEN 'NORMAL'::text
            ELSE 'BAIXA'::text
        END AS prioridade
   FROM ((public.requisicao_compra rc
     JOIN public.produtos p ON ((rc.id_produto = p.id)))
     LEFT JOIN public.contagem_estoque ce ON ((p.id_cache = ce.id_produto)))
  WHERE ((rc.status)::text <> ALL ((ARRAY['CANCELADA'::character varying, 'COMPRADA'::character varying])::text[]))
  GROUP BY rc.id, rc.numero_requisicao, rc.id_produto, p.referencia_produto, p.ds_produto, rc.quantidade_solicitada, rc.unidade, rc.data_necessidade, rc.status, p.estoque_minimo, p.ponto_pedido, p.lead_time_compra_dias, p.lote_compra, rc.numero_oc_aworks, rc.observacoes, rc.created_at
  ORDER BY
        CASE
            WHEN (COALESCE(sum(ce.quantidade_pacotes), (0)::numeric) < COALESCE(p.estoque_minimo, (0)::numeric)) THEN 'CRITICO'::text
            WHEN (COALESCE(sum(ce.quantidade_pacotes), (0)::numeric) < COALESCE(p.ponto_pedido, (0)::numeric)) THEN 'URGENTE'::text
            WHEN (rc.data_necessidade <= (CURRENT_DATE + 5)) THEN 'NORMAL'::text
            ELSE 'BAIXA'::text
        END, rc.data_necessidade;


ALTER VIEW public.vw_requisicoes_compra_pendentes OWNER TO postgres;

--
-- TOC entry 491 (class 1259 OID 4333188)
-- Name: vw_reservas_ativas; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.vw_reservas_ativas AS
 SELECT re.id AS id_reserva,
    re.pedidovendaid,
    re.pedidovendaitemid,
    re.id_posicao,
    re.quantidade_reservada,
    re.data_reserva,
    re.status,
    re.prioridade_pedido,
    po.codigo AS codigo_posicao,
    po.descricao AS descricao_posicao,
    sp.data_prioridade_separacao,
        CASE
            WHEN ((re.prioridade_pedido)::text = 'VERMELHO'::text) THEN 1
            WHEN ((re.prioridade_pedido)::text = 'LARANJA'::text) THEN 2
            WHEN ((re.prioridade_pedido)::text = 'AMARELO'::text) THEN 3
            WHEN ((re.prioridade_pedido)::text = 'VERDE'::text) THEN 4
            WHEN ((re.prioridade_pedido)::text = 'ROXO'::text) THEN 5
            ELSE 6
        END AS ordem_prioridade
   FROM ((public.reservas_estoque re
     LEFT JOIN public.posicoes po ON ((re.id_posicao = po.id)))
     LEFT JOIN public.separacao_pedidos sp ON ((re.pedidovendaid = sp.pedidovendaid)))
  WHERE ((re.status)::text = 'ATIVA'::text)
  ORDER BY
        CASE
            WHEN ((re.prioridade_pedido)::text = 'VERMELHO'::text) THEN 1
            WHEN ((re.prioridade_pedido)::text = 'LARANJA'::text) THEN 2
            WHEN ((re.prioridade_pedido)::text = 'AMARELO'::text) THEN 3
            WHEN ((re.prioridade_pedido)::text = 'VERDE'::text) THEN 4
            WHEN ((re.prioridade_pedido)::text = 'ROXO'::text) THEN 5
            ELSE 6
        END, re.data_reserva;


ALTER VIEW public.vw_reservas_ativas OWNER TO postgres;

--
-- TOC entry 541 (class 1259 OID 16640385)
-- Name: vw_separacao_pedidos_completa; Type: MATERIALIZED VIEW; Schema: public; Owner: postgres
--

CREATE MATERIALIZED VIEW public.vw_separacao_pedidos_completa AS
 WITH itens_finalizados AS (
         SELECT DISTINCT si.pedidovendaitemid
           FROM public.separacao_itens si
          WHERE ((si.status)::text = 'FINALIZADO'::text)
        ), itens_por_nota AS (
         SELECT COALESCE(NULLIF(ltrim(regexp_replace(COALESCE(pd_agg.nr_nota_pedidovenda, ''::text), '[^0-9]'::text, ''::text, 'g'::text), '0'::text), ''::text), '0'::text) AS nota_ref_normalizada,
            count(DISTINCT pi.pedidovendaitemid) FILTER (WHERE (COALESCE(pi.quantidade_entrega, (0)::numeric) > (0)::numeric)) AS total_itens_original,
            count(DISTINCT pi.pedidovendaitemid) FILTER (WHERE ((pi.quantidade_entrega - COALESCE(pi.quantidade_despachada, (0)::numeric)) > (0)::numeric)) AS total_itens_ativos,
            count(DISTINCT pi.pedidovendaitemid) FILTER (WHERE ((COALESCE(pi.quantidade_entrega, (0)::numeric) > (0)::numeric) AND (ifin.pedidovendaitemid IS NULL))) AS itens_pendentes,
            bool_and((COALESCE(pi.quantidade_despachada, (0)::numeric) >= pi.quantidade_entrega)) AS totalmente_despachado
           FROM ((public.vw_pedido_itens_aworks_simples pi
             JOIN public.vw_pedidos_despacho_completo pd_agg ON ((pd_agg.id = pi.pedidovendaid)))
             LEFT JOIN itens_finalizados ifin ON ((ifin.pedidovendaitemid = pi.pedidovendaitemid)))
          GROUP BY COALESCE(NULLIF(ltrim(regexp_replace(COALESCE(pd_agg.nr_nota_pedidovenda, ''::text), '[^0-9]'::text, ''::text, 'g'::text), '0'::text), ''::text), '0'::text)
        ), separacao_metricas_nota AS (
         SELECT COALESCE(NULLIF(ltrim(regexp_replace(COALESCE((sp.nr_nota_fiscal)::text, ''::text), '[^0-9]'::text, ''::text, 'g'::text), '0'::text), ''::text), '0'::text) AS nota_ref_normalizada,
            count(DISTINCT si.pedidovendaitemid) FILTER (WHERE (((si.status)::text = 'FINALIZADO'::text) OR (COALESCE(si.quantidade_separada, (0)::numeric) >= COALESCE(si.quantidade_solicitada, (0)::numeric)))) AS itens_separados,
            count(DISTINCT si.pedidovendaitemid) FILTER (WHERE (si.quantidade_conferida > (0)::numeric)) AS itens_conferidos
           FROM (public.separacao_pedidos sp
             LEFT JOIN public.separacao_itens si ON ((si.id_separacao_pedido = sp.id)))
          GROUP BY COALESCE(NULLIF(ltrim(regexp_replace(COALESCE((sp.nr_nota_fiscal)::text, ''::text), '[^0-9]'::text, ''::text, 'g'::text), '0'::text), ''::text), '0'::text)
        ), operadores_em_separacao AS (
         SELECT base.nota_ref_normalizada,
            array_agg(DISTINCT base.nome_operador ORDER BY base.nome_operador) FILTER (WHERE (base.nome_operador IS NOT NULL)) AS operadores_separando
           FROM ( SELECT COALESCE(NULLIF(ltrim(regexp_replace(COALESCE((sp.nr_nota_fiscal)::text, ''::text), '[^0-9]'::text, ''::text, 'g'::text), '0'::text), ''::text), '0'::text) AS nota_ref_normalizada,
                    NULLIF(TRIM(BOTH FROM o.nome), ''::text) AS nome_operador
                   FROM (public.separacao_pedidos sp
                     LEFT JOIN public.operadores o ON ((o.id = sp.id_operador)))
                  WHERE ((sp.status)::text = 'EM_SEPARACAO'::text)
                UNION
                 SELECT COALESCE(NULLIF(ltrim(regexp_replace(COALESCE((sp.nr_nota_fiscal)::text, ''::text), '[^0-9]'::text, ''::text, 'g'::text), '0'::text), ''::text), '0'::text) AS nota_ref_normalizada,
                    NULLIF(TRIM(BOTH FROM o.nome), ''::text) AS nome_operador
                   FROM ((public.separacao_pedidos sp
                     JOIN public.separacao_itens si ON ((si.id_separacao_pedido = sp.id)))
                     LEFT JOIN public.operadores o ON ((o.id = si.id_operador_separacao)))
                  WHERE ((si.status)::text = 'SEPARANDO'::text)) base
          GROUP BY base.nota_ref_normalizada
        ), pedidos_base AS (
         SELECT sp.id,
            sp.pedidovendaid,
            sp.nr_nota_fiscal,
            sp.status,
            sp.id_operador,
            sp.data_inicio_separacao,
            sp.data_fim_separacao,
            sp.observacoes,
            sp.created_at,
            sp.updated_at,
            sp.data_prioridade_separacao,
            pd.nr_nota_pedidovenda AS nr_nota_fiscal_view,
            pd.cliente_nome,
            pd.cidade,
            pd.uf AS uf_cidade,
            pd.peso_bruto,
            pd.volumes,
            pd.prioridade,
            pd.dt_faturamento_pedidovenda,
            pd.data_despacho_prevista_atualizada AS data_despacho_prevista,
            COALESCE(sp.nr_nota_fiscal, (pd.nr_nota_pedidovenda)::character varying) AS nota_ref,
            COALESCE(NULLIF(ltrim(regexp_replace(COALESCE((COALESCE(sp.nr_nota_fiscal, (pd.nr_nota_pedidovenda)::character varying))::text, ''::text), '[^0-9]'::text, ''::text, 'g'::text), '0'::text), ''::text), '0'::text) AS nota_ref_normalizada,
            row_number() OVER (PARTITION BY COALESCE(NULLIF(ltrim(regexp_replace(COALESCE((COALESCE(sp.nr_nota_fiscal, (pd.nr_nota_pedidovenda)::character varying))::text, ''::text), '[^0-9]'::text, ''::text, 'g'::text), '0'::text), ''::text), '0'::text) ORDER BY sp.id) AS nota_rank
           FROM (public.separacao_pedidos sp
             LEFT JOIN public.vw_pedidos_despacho_completo pd ON ((sp.pedidovendaid = pd.id)))
          WHERE ((1 = 1) AND (pd.cliente_nome IS NOT NULL) AND (pd.cliente_nome <> ''::text) AND ((sp.status)::text <> ALL ((ARRAY['FINALIZADO'::character varying, 'CANCELADO'::character varying])::text[])))
        )
 SELECT pb.id,
    pb.pedidovendaid,
    COALESCE(pb.nr_nota_fiscal, (pb.nr_nota_fiscal_view)::character varying) AS nr_nota_fiscal,
    pb.cliente_nome,
    pb.cidade,
    pb.uf_cidade,
    pb.peso_bruto,
    pb.volumes,
    pb.prioridade,
    pb.dt_faturamento_pedidovenda,
    pb.data_despacho_prevista,
    pb.data_prioridade_separacao,
    pb.status,
    pb.id_operador,
    pb.data_inicio_separacao,
    pb.data_fim_separacao,
    pb.observacoes,
    pb.created_at,
    pb.updated_at,
        CASE
            WHEN (pb.data_prioridade_separacao IS NULL) THEN 'ROXO'::text
            WHEN (pb.data_prioridade_separacao < CURRENT_DATE) THEN 'VERMELHO'::text
            WHEN (pb.data_prioridade_separacao = CURRENT_DATE) THEN 'VERMELHO'::text
            WHEN (pb.data_prioridade_separacao <= (CURRENT_DATE + '2 days'::interval)) THEN 'LARANJA'::text
            WHEN (pb.data_prioridade_separacao <= (CURRENT_DATE + '5 days'::interval)) THEN 'AMARELO'::text
            ELSE 'VERDE'::text
        END AS prioridade_separacao,
    COALESCE(ipn.total_itens_original, (0)::bigint) AS total_itens,
    COALESCE(ipn.total_itens_ativos, (0)::bigint) AS total_itens_ativos,
    COALESCE(smn.itens_separados, (0)::bigint) AS itens_separados,
    COALESCE(smn.itens_conferidos, (0)::bigint) AS itens_conferidos,
    COALESCE(ipn.itens_pendentes, (0)::bigint) AS itens_pendentes,
    COALESCE(oes.operadores_separando, ARRAY[]::text[]) AS operadores_separando,
    COALESCE(array_length(oes.operadores_separando, 1), 0) AS total_operadores_separando,
    ipn.totalmente_despachado,
    pb.nota_rank
   FROM (((pedidos_base pb
     LEFT JOIN itens_por_nota ipn ON ((ipn.nota_ref_normalizada = pb.nota_ref_normalizada)))
     LEFT JOIN separacao_metricas_nota smn ON ((smn.nota_ref_normalizada = pb.nota_ref_normalizada)))
     LEFT JOIN operadores_em_separacao oes ON ((oes.nota_ref_normalizada = pb.nota_ref_normalizada)))
  WHERE ((pb.nota_rank = 1) AND (COALESCE(ipn.total_itens_original, (0)::bigint) > 0) AND (COALESCE(ipn.total_itens_ativos, (0)::bigint) > 0) AND (COALESCE(ipn.totalmente_despachado, false) = false))
  WITH NO DATA;


ALTER MATERIALIZED VIEW public.vw_separacao_pedidos_completa OWNER TO postgres;

--
-- TOC entry 540 (class 1259 OID 16639922)
-- Name: vw_separacao_pedidos_rapida; Type: MATERIALIZED VIEW; Schema: public; Owner: postgres
--

CREATE MATERIALIZED VIEW public.vw_separacao_pedidos_rapida AS
 WITH pedidos_base AS (
         SELECT sp.id,
            sp.pedidovendaid,
            sp.nr_nota_fiscal,
            sp.cliente_nome,
            sp.status,
            sp.id_operador,
            sp.data_inicio_separacao,
            sp.data_fim_separacao,
            sp.observacoes,
            sp.created_at,
            sp.updated_at,
            sp.data_prioridade_separacao,
            pd.prioridade,
            pd.dt_faturamento_pedidovenda,
            pd.data_despacho_prevista_atualizada AS data_despacho_prevista,
            COALESCE(( SELECT count(*) AS count
                   FROM public.separacao_itens si
                  WHERE ((si.id_separacao_pedido = sp.id) AND (si.quantidade_solicitada > (0)::numeric))), (0)::bigint) AS total_itens,
            COALESCE(( SELECT count(*) AS count
                   FROM public.separacao_itens si
                  WHERE ((si.id_separacao_pedido = sp.id) AND (((si.status)::text = 'FINALIZADO'::text) OR (si.quantidade_separada >= si.quantidade_solicitada)))), (0)::bigint) AS itens_separados,
            COALESCE(( SELECT count(*) AS count
                   FROM public.separacao_itens si
                  WHERE ((si.id_separacao_pedido = sp.id) AND (si.quantidade_conferida > (0)::numeric))), (0)::bigint) AS itens_conferidos
           FROM (public.separacao_pedidos sp
             LEFT JOIN public.vw_pedidos_despacho_completo pd ON ((sp.pedidovendaid = pd.id)))
          WHERE (((sp.status)::text <> ALL ((ARRAY['FINALIZADO'::character varying, 'CANCELADO'::character varying])::text[])) AND (pd.cliente_nome IS NOT NULL) AND (pd.cliente_nome <> ''::text))
        )
 SELECT id,
    pedidovendaid,
    nr_nota_fiscal,
    cliente_nome,
    status,
    id_operador,
    data_inicio_separacao,
    data_fim_separacao,
    observacoes,
    created_at,
    updated_at,
    data_prioridade_separacao,
    prioridade,
    dt_faturamento_pedidovenda,
    data_despacho_prevista,
    total_itens,
    itens_separados,
    itens_conferidos,
        CASE
            WHEN (data_prioridade_separacao IS NULL) THEN 'ROXO'::text
            WHEN (data_prioridade_separacao < CURRENT_DATE) THEN 'VERMELHO'::text
            WHEN (data_prioridade_separacao = CURRENT_DATE) THEN 'VERMELHO'::text
            WHEN (data_prioridade_separacao <= (CURRENT_DATE + '2 days'::interval)) THEN 'LARANJA'::text
            WHEN (data_prioridade_separacao <= (CURRENT_DATE + '5 days'::interval)) THEN 'AMARELO'::text
            ELSE 'VERDE'::text
        END AS prioridade_separacao,
    (total_itens - itens_separados) AS itens_pendentes,
        CASE
            WHEN (total_itens > 0) THEN round((((itens_separados)::numeric * 100.0) / (total_itens)::numeric), 2)
            ELSE (0)::numeric
        END AS progresso_percentual
   FROM pedidos_base pb
  ORDER BY
        CASE status
            WHEN 'EM_SEPARACAO'::text THEN 1
            WHEN 'CONFERIDO'::text THEN 2
            WHEN 'PENDENTE'::text THEN 3
            ELSE 4
        END, data_prioridade_separacao, dt_faturamento_pedidovenda
  WITH NO DATA;


ALTER MATERIALIZED VIEW public.vw_separacao_pedidos_rapida OWNER TO postgres;

--
-- TOC entry 5726 (class 2604 OID 14395540)
-- Name: agenda_maquina id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agenda_maquina ALTER COLUMN id SET DEFAULT nextval('public.agenda_maquina_id_seq'::regclass);


--
-- TOC entry 5539 (class 2604 OID 49471)
-- Name: apontamento_producao id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.apontamento_producao ALTER COLUMN id SET DEFAULT nextval('public.apontamento_producao_id_seq'::regclass);


--
-- TOC entry 5582 (class 2604 OID 74336)
-- Name: apontamento_pulsos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.apontamento_pulsos ALTER COLUMN id SET DEFAULT nextval('public.apontamento_pulsos_id_seq'::regclass);


--
-- TOC entry 5715 (class 2604 OID 14395518)
-- Name: carga_maquina id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.carga_maquina ALTER COLUMN id SET DEFAULT nextval('public.carga_maquina_id_seq'::regclass);


--
-- TOC entry 5740 (class 2604 OID 14395582)
-- Name: carga_maquina_auditoria id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.carga_maquina_auditoria ALTER COLUMN id SET DEFAULT nextval('public.carga_maquina_auditoria_id_seq'::regclass);


--
-- TOC entry 5649 (class 2604 OID 191466)
-- Name: chat_mensagens id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_mensagens ALTER COLUMN id SET DEFAULT nextval('public.chat_mensagens_id_seq'::regclass);


--
-- TOC entry 5653 (class 2604 OID 191488)
-- Name: chat_notificacoes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_notificacoes ALTER COLUMN id SET DEFAULT nextval('public.chat_notificacoes_id_seq'::regclass);


--
-- TOC entry 5646 (class 2604 OID 191447)
-- Name: chat_participantes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_participantes ALTER COLUMN id SET DEFAULT nextval('public.chat_participantes_id_seq'::regclass);


--
-- TOC entry 5643 (class 2604 OID 191433)
-- Name: chat_salas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_salas ALTER COLUMN id SET DEFAULT nextval('public.chat_salas_id_seq'::regclass);


--
-- TOC entry 5606 (class 2604 OID 75019)
-- Name: checklist_execucoes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_execucoes ALTER COLUMN id SET DEFAULT nextval('public.checklist_execucoes_id_seq'::regclass);


--
-- TOC entry 5614 (class 2604 OID 78750)
-- Name: checklist_fotos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_fotos ALTER COLUMN id SET DEFAULT nextval('public.checklist_fotos_id_seq'::regclass);


--
-- TOC entry 5612 (class 2604 OID 75080)
-- Name: checklist_itens id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_itens ALTER COLUMN id SET DEFAULT nextval('public.checklist_itens_id_seq'::regclass);


--
-- TOC entry 5609 (class 2604 OID 75070)
-- Name: checklist_modelos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_modelos ALTER COLUMN id SET DEFAULT nextval('public.checklist_modelos_id_seq'::regclass);


--
-- TOC entry 5608 (class 2604 OID 75042)
-- Name: checklist_respostas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_respostas ALTER COLUMN id SET DEFAULT nextval('public.checklist_respostas_id_seq'::regclass);


--
-- TOC entry 5586 (class 2604 OID 74370)
-- Name: consultas_ia id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.consultas_ia ALTER COLUMN id SET DEFAULT nextval('public.consultas_ia_id_seq'::regclass);


--
-- TOC entry 5595 (class 2604 OID 74515)
-- Name: contagem_estoque id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.contagem_estoque ALTER COLUMN id SET DEFAULT nextval('public.contagem_estoque_id_seq'::regclass);


--
-- TOC entry 5603 (class 2604 OID 74950)
-- Name: defeitos_injecao id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.defeitos_injecao ALTER COLUMN id SET DEFAULT nextval('public.defeitos_injecao_id_seq'::regclass);


--
-- TOC entry 5771 (class 2604 OID 16713142)
-- Name: divergencias_estoque id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.divergencias_estoque ALTER COLUMN id SET DEFAULT nextval('public.divergencias_estoque_id_seq'::regclass);


--
-- TOC entry 5588 (class 2604 OID 74402)
-- Name: enderecos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.enderecos ALTER COLUMN id SET DEFAULT nextval('public.enderecos_id_seq'::regclass);


--
-- TOC entry 5679 (class 2604 OID 3943725)
-- Name: entrada_producao id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entrada_producao ALTER COLUMN id SET DEFAULT nextval('public.entrada_producao_id_seq'::regclass);


--
-- TOC entry 5688 (class 2604 OID 3943739)
-- Name: entrada_producao_itens id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entrada_producao_itens ALTER COLUMN id SET DEFAULT nextval('public.entrada_producao_itens_id_seq'::regclass);


--
-- TOC entry 5702 (class 2604 OID 6060466)
-- Name: entrada_producao_saidas_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entrada_producao_saidas_log ALTER COLUMN id SET DEFAULT nextval('public.entrada_producao_saidas_log_id_seq'::regclass);


--
-- TOC entry 5623 (class 2604 OID 78922)
-- Name: estoque id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estoque ALTER COLUMN id SET DEFAULT nextval('public.estoque_id_seq'::regclass);


--
-- TOC entry 5711 (class 2604 OID 9967753)
-- Name: estoque_auditoria_eventos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estoque_auditoria_eventos ALTER COLUMN id SET DEFAULT nextval('public.estoque_auditoria_eventos_id_seq'::regclass);


--
-- TOC entry 5707 (class 2604 OID 9402047)
-- Name: estoque_movimentacoes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estoque_movimentacoes ALTER COLUMN id SET DEFAULT nextval('public.estoque_movimentacoes_id_seq'::regclass);


--
-- TOC entry 5747 (class 2604 OID 16356125)
-- Name: estrutura_produtos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estrutura_produtos ALTER COLUMN id SET DEFAULT nextval('public.estrutura_produtos_id_seq'::regclass);


--
-- TOC entry 5604 (class 2604 OID 74963)
-- Name: fatores_qualidade id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fatores_qualidade ALTER COLUMN id SET DEFAULT nextval('public.fatores_qualidade_id_seq'::regclass);


--
-- TOC entry 5578 (class 2604 OID 74280)
-- Name: historico_manutencoes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historico_manutencoes ALTER COLUMN id SET DEFAULT nextval('public.historico_manutencoes_id_seq'::regclass);


--
-- TOC entry 5600 (class 2604 OID 74781)
-- Name: inventario id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventario ALTER COLUMN id SET DEFAULT nextval('public.inventario_id_seq'::regclass);


--
-- TOC entry 5634 (class 2604 OID 125718)
-- Name: locais_estoque id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.locais_estoque ALTER COLUMN id SET DEFAULT nextval('public.locais_estoque_id_seq'::regclass);


--
-- TOC entry 5550 (class 2604 OID 65869)
-- Name: logs_apontamento id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.logs_apontamento ALTER COLUMN id SET DEFAULT nextval('public.logs_apontamento_id_seq'::regclass);


--
-- TOC entry 5626 (class 2604 OID 90787)
-- Name: logs_impressao id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.logs_impressao ALTER COLUMN id SET DEFAULT nextval('public.logs_impressao_id_seq'::regclass);


--
-- TOC entry 5774 (class 2604 OID 16727649)
-- Name: logs_sistema id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.logs_sistema ALTER COLUMN id SET DEFAULT nextval('public.logs_sistema_id_seq'::regclass);


--
-- TOC entry 5731 (class 2604 OID 14395557)
-- Name: maquina_molde id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.maquina_molde ALTER COLUMN id SET DEFAULT nextval('public.maquina_molde_id_seq'::regclass);


--
-- TOC entry 5528 (class 2604 OID 49424)
-- Name: maquinas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.maquinas ALTER COLUMN id SET DEFAULT nextval('public.maquinas_id_seq'::regclass);


--
-- TOC entry 5630 (class 2604 OID 105028)
-- Name: metricas_desempenho id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.metricas_desempenho ALTER COLUMN id SET DEFAULT nextval('public.metricas_desempenho_id_seq'::regclass);


--
-- TOC entry 5591 (class 2604 OID 74473)
-- Name: modulos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.modulos ALTER COLUMN id SET DEFAULT nextval('public.modulos_id_seq'::regclass);


--
-- TOC entry 5559 (class 2604 OID 74144)
-- Name: moldes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes ALTER COLUMN id SET DEFAULT nextval('public.moldes_id_seq'::regclass);


--
-- TOC entry 5569 (class 2604 OID 74201)
-- Name: moldes_maquinas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes_maquinas ALTER COLUMN id SET DEFAULT nextval('public.moldes_maquinas_id_seq'::regclass);


--
-- TOC entry 5566 (class 2604 OID 74178)
-- Name: moldes_produtos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes_produtos ALTER COLUMN id SET DEFAULT nextval('public.moldes_produtos_id_seq'::regclass);


--
-- TOC entry 5564 (class 2604 OID 74163)
-- Name: moldes_versoes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes_versoes ALTER COLUMN id SET DEFAULT nextval('public.moldes_versoes_id_seq'::regclass);


--
-- TOC entry 5554 (class 2604 OID 65897)
-- Name: motivos_refugo id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.motivos_refugo ALTER COLUMN id SET DEFAULT nextval('public.motivos_refugo_id_seq'::regclass);


--
-- TOC entry 5618 (class 2604 OID 78819)
-- Name: movimentacoes_estoque id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimentacoes_estoque ALTER COLUMN id SET DEFAULT nextval('public.movimentacoes_estoque_id_seq'::regclass);


--
-- TOC entry 5605 (class 2604 OID 75010)
-- Name: nao_conformidades id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.nao_conformidades ALTER COLUMN id SET DEFAULT nextval('public.nao_conformidades_id_seq'::regclass);


--
-- TOC entry 5592 (class 2604 OID 74487)
-- Name: niveis id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.niveis ALTER COLUMN id SET DEFAULT nextval('public.niveis_id_seq'::regclass);


--
-- TOC entry 5632 (class 2604 OID 105036)
-- Name: oee_calculado id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oee_calculado ALTER COLUMN id SET DEFAULT nextval('public.oee_calculado_id_seq'::regclass);


--
-- TOC entry 5525 (class 2604 OID 49415)
-- Name: operadores id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operadores ALTER COLUMN id SET DEFAULT nextval('public.operadores_id_seq'::regclass);


--
-- TOC entry 5556 (class 2604 OID 65927)
-- Name: operadores_faces id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operadores_faces ALTER COLUMN id SET DEFAULT nextval('public.operadores_faces_id_seq'::regclass);


--
-- TOC entry 5656 (class 2604 OID 194591)
-- Name: operadores_status id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operadores_status ALTER COLUMN id SET DEFAULT nextval('public.operadores_status_id_seq'::regclass);


--
-- TOC entry 5753 (class 2604 OID 16372745)
-- Name: ordem_producao_estrutura_itens id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordem_producao_estrutura_itens ALTER COLUMN id SET DEFAULT nextval('public.ordem_producao_estrutura_itens_id_seq'::regclass);


--
-- TOC entry 5759 (class 2604 OID 16372764)
-- Name: ordem_producao_necessidades id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordem_producao_necessidades ALTER COLUMN id SET DEFAULT nextval('public.ordem_producao_necessidades_id_seq'::regclass);


--
-- TOC entry 5544 (class 2604 OID 49494)
-- Name: paradas_producao id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paradas_producao ALTER COLUMN id SET DEFAULT nextval('public.paradas_producao_id_seq'::regclass);


--
-- TOC entry 5570 (class 2604 OID 74223)
-- Name: planejamento_producao id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.planejamento_producao ALTER COLUMN id SET DEFAULT nextval('public.planejamento_producao_id_seq'::regclass);


--
-- TOC entry 5593 (class 2604 OID 74501)
-- Name: posicoes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posicoes ALTER COLUMN id SET DEFAULT nextval('public.posicoes_id_seq'::regclass);


--
-- TOC entry 5620 (class 2604 OID 78896)
-- Name: produto_id_mapping id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.produto_id_mapping ALTER COLUMN id SET DEFAULT nextval('public.produto_id_mapping_id_seq'::regclass);


--
-- TOC entry 5530 (class 2604 OID 49445)
-- Name: produtos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.produtos ALTER COLUMN id SET DEFAULT nextval('public.produtos_id_seq'::regclass);


--
-- TOC entry 5580 (class 2604 OID 74328)
-- Name: pulsos_maquina id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pulsos_maquina ALTER COLUMN id SET DEFAULT nextval('public.pulsos_maquina_id_seq'::regclass);


--
-- TOC entry 5674 (class 2604 OID 3846794)
-- Name: relatorios_falta_estoque id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.relatorios_falta_estoque ALTER COLUMN id SET DEFAULT nextval('public.relatorios_falta_estoque_id_seq'::regclass);


--
-- TOC entry 5766 (class 2604 OID 16424322)
-- Name: requisicao_compra id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.requisicao_compra ALTER COLUMN id SET DEFAULT nextval('public.requisicao_compra_id_seq'::regclass);


--
-- TOC entry 5692 (class 2604 OID 4333158)
-- Name: reservas_estoque id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reservas_estoque ALTER COLUMN id SET DEFAULT nextval('public.reservas_estoque_id_seq'::regclass);


--
-- TOC entry 5590 (class 2604 OID 74464)
-- Name: ruas id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ruas ALTER COLUMN id SET DEFAULT nextval('public.ruas_id_seq'::regclass);


--
-- TOC entry 5666 (class 2604 OID 3236269)
-- Name: separacao_itens id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.separacao_itens ALTER COLUMN id SET DEFAULT nextval('public.separacao_itens_id_seq'::regclass);


--
-- TOC entry 5662 (class 2604 OID 3236223)
-- Name: separacao_pedidos id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.separacao_pedidos ALTER COLUMN id SET DEFAULT nextval('public.separacao_pedidos_id_seq'::regclass);


--
-- TOC entry 5736 (class 2604 OID 14395571)
-- Name: setup_maquina id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.setup_maquina ALTER COLUMN id SET DEFAULT nextval('public.setup_maquina_id_seq'::regclass);


--
-- TOC entry 5575 (class 2604 OID 74272)
-- Name: tipos_manutencao id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tipos_manutencao ALTER COLUMN id SET DEFAULT nextval('public.tipos_manutencao_id_seq'::regclass);


--
-- TOC entry 5616 (class 2604 OID 78810)
-- Name: tipos_movimentacao id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tipos_movimentacao ALTER COLUMN id SET DEFAULT nextval('public.tipos_movimentacao_id_seq'::regclass);


--
-- TOC entry 5697 (class 2604 OID 4766628)
-- Name: transferencias id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transferencias ALTER COLUMN id SET DEFAULT nextval('public.transferencias_id_seq'::regclass);


--
-- TOC entry 5641 (class 2604 OID 153685)
-- Name: unidade_conversao id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.unidade_conversao ALTER COLUMN id SET DEFAULT nextval('public.unidade_conversao_id_seq'::regclass);


--
-- TOC entry 5638 (class 2604 OID 153673)
-- Name: unidades id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.unidades ALTER COLUMN id SET DEFAULT nextval('public.unidades_id_seq'::regclass);


--
-- TOC entry 6057 (class 2606 OID 14395546)
-- Name: agenda_maquina agenda_maquina_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agenda_maquina
    ADD CONSTRAINT agenda_maquina_pkey PRIMARY KEY (id);


--
-- TOC entry 5813 (class 2606 OID 49474)
-- Name: apontamento_producao apontamento_producao_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.apontamento_producao
    ADD CONSTRAINT apontamento_producao_pkey PRIMARY KEY (id);


--
-- TOC entry 5864 (class 2606 OID 74339)
-- Name: apontamento_pulsos apontamento_pulsos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.apontamento_pulsos
    ADD CONSTRAINT apontamento_pulsos_pkey PRIMARY KEY (id);


--
-- TOC entry 6068 (class 2606 OID 14395587)
-- Name: carga_maquina_auditoria carga_maquina_auditoria_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.carga_maquina_auditoria
    ADD CONSTRAINT carga_maquina_auditoria_pkey PRIMARY KEY (id);


--
-- TOC entry 6051 (class 2606 OID 14395532)
-- Name: carga_maquina carga_maquina_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.carga_maquina
    ADD CONSTRAINT carga_maquina_pkey PRIMARY KEY (id);


--
-- TOC entry 5958 (class 2606 OID 191473)
-- Name: chat_mensagens chat_mensagens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_mensagens
    ADD CONSTRAINT chat_mensagens_pkey PRIMARY KEY (id);


--
-- TOC entry 5960 (class 2606 OID 191492)
-- Name: chat_notificacoes chat_notificacoes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_notificacoes
    ADD CONSTRAINT chat_notificacoes_pkey PRIMARY KEY (id);


--
-- TOC entry 5956 (class 2606 OID 191451)
-- Name: chat_participantes chat_participantes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_participantes
    ADD CONSTRAINT chat_participantes_pkey PRIMARY KEY (id);


--
-- TOC entry 5954 (class 2606 OID 191437)
-- Name: chat_salas chat_salas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_salas
    ADD CONSTRAINT chat_salas_pkey PRIMARY KEY (id);


--
-- TOC entry 5908 (class 2606 OID 75022)
-- Name: checklist_execucoes checklist_execucoes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_execucoes
    ADD CONSTRAINT checklist_execucoes_pkey PRIMARY KEY (id);


--
-- TOC entry 5920 (class 2606 OID 78755)
-- Name: checklist_fotos checklist_fotos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_fotos
    ADD CONSTRAINT checklist_fotos_pkey PRIMARY KEY (id);


--
-- TOC entry 5916 (class 2606 OID 75086)
-- Name: checklist_itens checklist_itens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_itens
    ADD CONSTRAINT checklist_itens_pkey PRIMARY KEY (id);


--
-- TOC entry 5914 (class 2606 OID 75075)
-- Name: checklist_modelos checklist_modelos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_modelos
    ADD CONSTRAINT checklist_modelos_pkey PRIMARY KEY (id);


--
-- TOC entry 5912 (class 2606 OID 75046)
-- Name: checklist_respostas checklist_respostas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_respostas
    ADD CONSTRAINT checklist_respostas_pkey PRIMARY KEY (id);


--
-- TOC entry 5869 (class 2606 OID 74375)
-- Name: consultas_ia consultas_ia_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.consultas_ia
    ADD CONSTRAINT consultas_ia_pkey PRIMARY KEY (id);


--
-- TOC entry 5894 (class 2606 OID 74518)
-- Name: contagem_estoque contagem_estoque_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.contagem_estoque
    ADD CONSTRAINT contagem_estoque_pkey PRIMARY KEY (id);


--
-- TOC entry 6029 (class 2606 OID 8018009)
-- Name: controle_entrada_producao controle_entrada_producao_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.controle_entrada_producao
    ADD CONSTRAINT controle_entrada_producao_pkey PRIMARY KEY (chave);


--
-- TOC entry 5900 (class 2606 OID 74957)
-- Name: defeitos_injecao defeitos_injecao_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.defeitos_injecao
    ADD CONSTRAINT defeitos_injecao_codigo_key UNIQUE (codigo);


--
-- TOC entry 5902 (class 2606 OID 74955)
-- Name: defeitos_injecao defeitos_injecao_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.defeitos_injecao
    ADD CONSTRAINT defeitos_injecao_pkey PRIMARY KEY (id);


--
-- TOC entry 6110 (class 2606 OID 16713148)
-- Name: divergencias_estoque divergencias_estoque_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.divergencias_estoque
    ADD CONSTRAINT divergencias_estoque_pkey PRIMARY KEY (id);


--
-- TOC entry 5872 (class 2606 OID 74405)
-- Name: enderecos enderecos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.enderecos
    ADD CONSTRAINT enderecos_pkey PRIMARY KEY (id);


--
-- TOC entry 5874 (class 2606 OID 74407)
-- Name: enderecos enderecos_rua_modulo_nivel_posicao_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.enderecos
    ADD CONSTRAINT enderecos_rua_modulo_nivel_posicao_key UNIQUE (rua, modulo, nivel, posicao);


--
-- TOC entry 6004 (class 2606 OID 3943746)
-- Name: entrada_producao_itens entrada_producao_itens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entrada_producao_itens
    ADD CONSTRAINT entrada_producao_itens_pkey PRIMARY KEY (id);


--
-- TOC entry 5999 (class 2606 OID 3943734)
-- Name: entrada_producao entrada_producao_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entrada_producao
    ADD CONSTRAINT entrada_producao_pkey PRIMARY KEY (id);


--
-- TOC entry 6024 (class 2606 OID 6060473)
-- Name: entrada_producao_saidas_log entrada_producao_saidas_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entrada_producao_saidas_log
    ADD CONSTRAINT entrada_producao_saidas_log_pkey PRIMARY KEY (id);


--
-- TOC entry 6039 (class 2606 OID 9967761)
-- Name: estoque_auditoria_eventos estoque_auditoria_eventos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estoque_auditoria_eventos
    ADD CONSTRAINT estoque_auditoria_eventos_pkey PRIMARY KEY (id);


--
-- TOC entry 6031 (class 2606 OID 9402054)
-- Name: estoque_movimentacoes estoque_movimentacoes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estoque_movimentacoes
    ADD CONSTRAINT estoque_movimentacoes_pkey PRIMARY KEY (id);


--
-- TOC entry 5930 (class 2606 OID 78926)
-- Name: estoque estoque_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estoque
    ADD CONSTRAINT estoque_pkey PRIMARY KEY (id);


--
-- TOC entry 5932 (class 2606 OID 78928)
-- Name: estoque estoque_produto_posicao; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estoque
    ADD CONSTRAINT estoque_produto_posicao UNIQUE (produto_id, posicao_id);


--
-- TOC entry 6080 (class 2606 OID 16356134)
-- Name: estrutura_produtos estrutura_produtos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estrutura_produtos
    ADD CONSTRAINT estrutura_produtos_pkey PRIMARY KEY (id);


--
-- TOC entry 5904 (class 2606 OID 74965)
-- Name: fatores_qualidade fatores_qualidade_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fatores_qualidade
    ADD CONSTRAINT fatores_qualidade_pkey PRIMARY KEY (id);


--
-- TOC entry 6074 (class 2606 OID 15493598)
-- Name: grupoproduto grupoproduto_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grupoproduto
    ADD CONSTRAINT grupoproduto_pkey PRIMARY KEY (grupoprodutoid);


--
-- TOC entry 5858 (class 2606 OID 74286)
-- Name: historico_manutencoes historico_manutencoes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historico_manutencoes
    ADD CONSTRAINT historico_manutencoes_pkey PRIMARY KEY (id);


--
-- TOC entry 5898 (class 2606 OID 74786)
-- Name: inventario inventario_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventario
    ADD CONSTRAINT inventario_pkey PRIMARY KEY (id);


--
-- TOC entry 5944 (class 2606 OID 125726)
-- Name: locais_estoque locais_estoque_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.locais_estoque
    ADD CONSTRAINT locais_estoque_codigo_key UNIQUE (codigo);


--
-- TOC entry 5946 (class 2606 OID 125724)
-- Name: locais_estoque locais_estoque_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.locais_estoque
    ADD CONSTRAINT locais_estoque_pkey PRIMARY KEY (id);


--
-- TOC entry 5827 (class 2606 OID 65874)
-- Name: logs_apontamento logs_apontamento_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.logs_apontamento
    ADD CONSTRAINT logs_apontamento_pkey PRIMARY KEY (id);


--
-- TOC entry 5936 (class 2606 OID 90792)
-- Name: logs_impressao logs_impressao_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.logs_impressao
    ADD CONSTRAINT logs_impressao_pkey PRIMARY KEY (id);


--
-- TOC entry 6121 (class 2606 OID 16727654)
-- Name: logs_sistema logs_sistema_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.logs_sistema
    ADD CONSTRAINT logs_sistema_pkey PRIMARY KEY (id);


--
-- TOC entry 6061 (class 2606 OID 14395563)
-- Name: maquina_molde maquina_molde_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.maquina_molde
    ADD CONSTRAINT maquina_molde_pkey PRIMARY KEY (id);


--
-- TOC entry 5918 (class 2606 OID 75096)
-- Name: maquina_tipos_processo maquina_tipos_processo_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.maquina_tipos_processo
    ADD CONSTRAINT maquina_tipos_processo_pkey PRIMARY KEY (maquina_tipo);


--
-- TOC entry 5804 (class 2606 OID 49426)
-- Name: maquinas maquinas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.maquinas
    ADD CONSTRAINT maquinas_pkey PRIMARY KEY (id);


--
-- TOC entry 5938 (class 2606 OID 105031)
-- Name: metricas_desempenho metricas_desempenho_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.metricas_desempenho
    ADD CONSTRAINT metricas_desempenho_pkey PRIMARY KEY (id);


--
-- TOC entry 5880 (class 2606 OID 74477)
-- Name: modulos modulos_id_rua_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.modulos
    ADD CONSTRAINT modulos_id_rua_codigo_key UNIQUE (id_rua, codigo);


--
-- TOC entry 5882 (class 2606 OID 74475)
-- Name: modulos modulos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.modulos
    ADD CONSTRAINT modulos_pkey PRIMARY KEY (id);


--
-- TOC entry 5834 (class 2606 OID 74151)
-- Name: moldes moldes_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes
    ADD CONSTRAINT moldes_codigo_key UNIQUE (codigo);


--
-- TOC entry 5846 (class 2606 OID 74205)
-- Name: moldes_maquinas moldes_maquinas_id_molde_id_maquina_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes_maquinas
    ADD CONSTRAINT moldes_maquinas_id_molde_id_maquina_key UNIQUE (id_molde, id_maquina);


--
-- TOC entry 5848 (class 2606 OID 74203)
-- Name: moldes_maquinas moldes_maquinas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes_maquinas
    ADD CONSTRAINT moldes_maquinas_pkey PRIMARY KEY (id);


--
-- TOC entry 5836 (class 2606 OID 74149)
-- Name: moldes moldes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes
    ADD CONSTRAINT moldes_pkey PRIMARY KEY (id);


--
-- TOC entry 5842 (class 2606 OID 74183)
-- Name: moldes_produtos moldes_produtos_id_versao_molde_id_produto_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes_produtos
    ADD CONSTRAINT moldes_produtos_id_versao_molde_id_produto_key UNIQUE (id_versao_molde, id_produto);


--
-- TOC entry 5844 (class 2606 OID 74181)
-- Name: moldes_produtos moldes_produtos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes_produtos
    ADD CONSTRAINT moldes_produtos_pkey PRIMARY KEY (id);


--
-- TOC entry 5838 (class 2606 OID 74260)
-- Name: moldes_versoes moldes_versoes_id_molde_versao_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes_versoes
    ADD CONSTRAINT moldes_versoes_id_molde_versao_key UNIQUE (id_molde, versao);


--
-- TOC entry 5840 (class 2606 OID 74166)
-- Name: moldes_versoes moldes_versoes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes_versoes
    ADD CONSTRAINT moldes_versoes_pkey PRIMARY KEY (id);


--
-- TOC entry 5829 (class 2606 OID 65900)
-- Name: motivos_refugo motivos_refugo_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.motivos_refugo
    ADD CONSTRAINT motivos_refugo_pkey PRIMARY KEY (id);


--
-- TOC entry 5924 (class 2606 OID 78825)
-- Name: movimentacoes_estoque movimentacoes_estoque_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimentacoes_estoque
    ADD CONSTRAINT movimentacoes_estoque_pkey PRIMARY KEY (id);


--
-- TOC entry 5906 (class 2606 OID 75014)
-- Name: nao_conformidades nao_conformidades_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.nao_conformidades
    ADD CONSTRAINT nao_conformidades_pkey PRIMARY KEY (id);


--
-- TOC entry 5884 (class 2606 OID 74491)
-- Name: niveis niveis_id_modulo_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.niveis
    ADD CONSTRAINT niveis_id_modulo_codigo_key UNIQUE (id_modulo, codigo);


--
-- TOC entry 5886 (class 2606 OID 74489)
-- Name: niveis niveis_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.niveis
    ADD CONSTRAINT niveis_pkey PRIMARY KEY (id);


--
-- TOC entry 5942 (class 2606 OID 105039)
-- Name: oee_calculado oee_calculado_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oee_calculado
    ADD CONSTRAINT oee_calculado_pkey PRIMARY KEY (id);


--
-- TOC entry 5800 (class 2606 OID 49419)
-- Name: operadores operadores_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operadores
    ADD CONSTRAINT operadores_email_key UNIQUE (email);


--
-- TOC entry 5832 (class 2606 OID 65933)
-- Name: operadores_faces operadores_faces_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operadores_faces
    ADD CONSTRAINT operadores_faces_pkey PRIMARY KEY (id);


--
-- TOC entry 5802 (class 2606 OID 49417)
-- Name: operadores operadores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operadores
    ADD CONSTRAINT operadores_pkey PRIMARY KEY (id);


--
-- TOC entry 5964 (class 2606 OID 194595)
-- Name: operadores_status operadores_status_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operadores_status
    ADD CONSTRAINT operadores_status_pkey PRIMARY KEY (id);


--
-- TOC entry 6090 (class 2606 OID 16372754)
-- Name: ordem_producao_estrutura_itens ordem_producao_estrutura_itens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordem_producao_estrutura_itens
    ADD CONSTRAINT ordem_producao_estrutura_itens_pkey PRIMARY KEY (id);


--
-- TOC entry 6094 (class 2606 OID 16372774)
-- Name: ordem_producao_necessidades ordem_producao_necessidades_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordem_producao_necessidades
    ADD CONSTRAINT ordem_producao_necessidades_pkey PRIMARY KEY (id);


--
-- TOC entry 5825 (class 2606 OID 57643)
-- Name: ordem_producao ordem_producao_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordem_producao
    ADD CONSTRAINT ordem_producao_pkey PRIMARY KEY (id);


--
-- TOC entry 5822 (class 2606 OID 49498)
-- Name: paradas_producao paradas_producao_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paradas_producao
    ADD CONSTRAINT paradas_producao_pkey PRIMARY KEY (id);


--
-- TOC entry 5966 (class 2606 OID 206131)
-- Name: pedidos_despacho_previsto pedidos_despacho_previsto_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pedidos_despacho_previsto
    ADD CONSTRAINT pedidos_despacho_previsto_pkey PRIMARY KEY (pedidovendaid);


--
-- TOC entry 5852 (class 2606 OID 74228)
-- Name: planejamento_producao planejamento_producao_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.planejamento_producao
    ADD CONSTRAINT planejamento_producao_pkey PRIMARY KEY (id);


--
-- TOC entry 5888 (class 2606 OID 74939)
-- Name: posicoes posicoes_codigo_barras_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posicoes
    ADD CONSTRAINT posicoes_codigo_barras_key UNIQUE (codigo_barras);


--
-- TOC entry 5890 (class 2606 OID 74505)
-- Name: posicoes posicoes_id_nivel_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posicoes
    ADD CONSTRAINT posicoes_id_nivel_codigo_key UNIQUE (id_nivel, codigo);


--
-- TOC entry 5892 (class 2606 OID 74503)
-- Name: posicoes posicoes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posicoes
    ADD CONSTRAINT posicoes_pkey PRIMARY KEY (id);


--
-- TOC entry 5926 (class 2606 OID 78902)
-- Name: produto_id_mapping produto_id_mapping_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.produto_id_mapping
    ADD CONSTRAINT produto_id_mapping_pkey PRIMARY KEY (id);


--
-- TOC entry 5811 (class 2606 OID 49447)
-- Name: produtos produtos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.produtos
    ADD CONSTRAINT produtos_pkey PRIMARY KEY (id);


--
-- TOC entry 5970 (class 2606 OID 3089102)
-- Name: pulse pulse_entity_id_key; Type: CONSTRAINT; Schema: public; Owner: metabase_user
--

ALTER TABLE ONLY public.pulse
    ADD CONSTRAINT pulse_entity_id_key UNIQUE (entity_id);


--
-- TOC entry 5972 (class 2606 OID 3089104)
-- Name: pulse pulse_pkey; Type: CONSTRAINT; Schema: public; Owner: metabase_user
--

ALTER TABLE ONLY public.pulse
    ADD CONSTRAINT pulse_pkey PRIMARY KEY (id);


--
-- TOC entry 5862 (class 2606 OID 74331)
-- Name: pulsos_maquina pulsos_maquina_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pulsos_maquina
    ADD CONSTRAINT pulsos_maquina_pkey PRIMARY KEY (id);


--
-- TOC entry 5997 (class 2606 OID 3846803)
-- Name: relatorios_falta_estoque relatorios_falta_estoque_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.relatorios_falta_estoque
    ADD CONSTRAINT relatorios_falta_estoque_pkey PRIMARY KEY (id);


--
-- TOC entry 6100 (class 2606 OID 16424333)
-- Name: requisicao_compra requisicao_compra_numero_requisicao_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.requisicao_compra
    ADD CONSTRAINT requisicao_compra_numero_requisicao_key UNIQUE (numero_requisicao);


--
-- TOC entry 6102 (class 2606 OID 16424331)
-- Name: requisicao_compra requisicao_compra_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.requisicao_compra
    ADD CONSTRAINT requisicao_compra_pkey PRIMARY KEY (id);


--
-- TOC entry 6015 (class 2606 OID 4333168)
-- Name: reservas_estoque reservas_estoque_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reservas_estoque
    ADD CONSTRAINT reservas_estoque_pkey PRIMARY KEY (id);


--
-- TOC entry 5876 (class 2606 OID 74468)
-- Name: ruas ruas_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ruas
    ADD CONSTRAINT ruas_codigo_key UNIQUE (codigo);


--
-- TOC entry 5878 (class 2606 OID 74466)
-- Name: ruas ruas_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ruas
    ADD CONSTRAINT ruas_pkey PRIMARY KEY (id);


--
-- TOC entry 6022 (class 2606 OID 6055230)
-- Name: separacao_itens_bloqueio separacao_itens_bloqueio_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.separacao_itens_bloqueio
    ADD CONSTRAINT separacao_itens_bloqueio_pkey PRIMARY KEY (id);


--
-- TOC entry 5991 (class 2606 OID 3236278)
-- Name: separacao_itens separacao_itens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.separacao_itens
    ADD CONSTRAINT separacao_itens_pkey PRIMARY KEY (id);


--
-- TOC entry 5978 (class 2606 OID 3236232)
-- Name: separacao_pedidos separacao_pedidos_pedidovendaid_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.separacao_pedidos
    ADD CONSTRAINT separacao_pedidos_pedidovendaid_key UNIQUE (pedidovendaid);


--
-- TOC entry 5980 (class 2606 OID 3236230)
-- Name: separacao_pedidos separacao_pedidos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.separacao_pedidos
    ADD CONSTRAINT separacao_pedidos_pkey PRIMARY KEY (id);


--
-- TOC entry 6066 (class 2606 OID 14395576)
-- Name: setup_maquina setup_maquina_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.setup_maquina
    ADD CONSTRAINT setup_maquina_pkey PRIMARY KEY (id);


--
-- TOC entry 6078 (class 2606 OID 15493607)
-- Name: subgrupoproduto subgrupoproduto_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subgrupoproduto
    ADD CONSTRAINT subgrupoproduto_pkey PRIMARY KEY (subgrupoprodutoid);


--
-- TOC entry 5856 (class 2606 OID 74275)
-- Name: tipos_manutencao tipos_manutencao_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tipos_manutencao
    ADD CONSTRAINT tipos_manutencao_pkey PRIMARY KEY (id);


--
-- TOC entry 5922 (class 2606 OID 78814)
-- Name: tipos_movimentacao tipos_movimentacao_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tipos_movimentacao
    ADD CONSTRAINT tipos_movimentacao_pkey PRIMARY KEY (id);


--
-- TOC entry 6017 (class 2606 OID 4766631)
-- Name: transferencias transferencias_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transferencias
    ADD CONSTRAINT transferencias_pkey PRIMARY KEY (id);


--
-- TOC entry 5854 (class 2606 OID 74250)
-- Name: turnos turnos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.turnos
    ADD CONSTRAINT turnos_pkey PRIMARY KEY (nome);


--
-- TOC entry 5952 (class 2606 OID 153688)
-- Name: unidade_conversao unidade_conversao_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.unidade_conversao
    ADD CONSTRAINT unidade_conversao_pkey PRIMARY KEY (id);


--
-- TOC entry 5948 (class 2606 OID 153680)
-- Name: unidades unidades_codigo_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.unidades
    ADD CONSTRAINT unidades_codigo_key UNIQUE (codigo);


--
-- TOC entry 5950 (class 2606 OID 153678)
-- Name: unidades unidades_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.unidades
    ADD CONSTRAINT unidades_pkey PRIMARY KEY (id);


--
-- TOC entry 5928 (class 2606 OID 78904)
-- Name: produto_id_mapping unique_mapping; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.produto_id_mapping
    ADD CONSTRAINT unique_mapping UNIQUE (id_original, id_cache);


--
-- TOC entry 6086 (class 2606 OID 16356136)
-- Name: estrutura_produtos uq_estrutura_produtos_aworks; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estrutura_produtos
    ADD CONSTRAINT uq_estrutura_produtos_aworks UNIQUE (id_estrutura_aworks, id_produto_cache, id_componente_cache);


--
-- TOC entry 6063 (class 2606 OID 14395565)
-- Name: maquina_molde uq_maquina_molde; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.maquina_molde
    ADD CONSTRAINT uq_maquina_molde UNIQUE (id_maquina, id_molde);


--
-- TOC entry 6096 (class 2606 OID 16372776)
-- Name: ordem_producao_necessidades uq_ordem_necessidade; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordem_producao_necessidades
    ADD CONSTRAINT uq_ordem_necessidade UNIQUE (id_ordem_producao, id_produto_cache);


--
-- TOC entry 6058 (class 1259 OID 14395552)
-- Name: idx_agenda_maquina_periodo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_agenda_maquina_periodo ON public.agenda_maquina USING btree (id_maquina, data_inicio, data_fim);


--
-- TOC entry 5814 (class 1259 OID 121402)
-- Name: idx_apontamento_datafim; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_apontamento_datafim ON public.apontamento_producao USING btree (data_fim);


--
-- TOC entry 5815 (class 1259 OID 1601401)
-- Name: idx_apontamento_maquina_data; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_apontamento_maquina_data ON public.apontamento_producao USING btree (id_maquina, data_inicio) WHERE ((status)::text = ANY ((ARRAY['EM_ANDAMENTO'::character varying, 'FINALIZADO'::character varying])::text[]));


--
-- TOC entry 5816 (class 1259 OID 121403)
-- Name: idx_apontamento_operador; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_apontamento_operador ON public.apontamento_producao USING btree (id_operador);


--
-- TOC entry 5817 (class 1259 OID 13446142)
-- Name: idx_apontamento_producao_injetora_maquina_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_apontamento_producao_injetora_maquina_estado ON public.apontamento_producao USING btree (id_maquina, estado_injetora, data_inicio DESC);


--
-- TOC entry 5818 (class 1259 OID 13446143)
-- Name: idx_apontamento_producao_injetora_molde; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_apontamento_producao_injetora_molde ON public.apontamento_producao USING btree (id_molde);


--
-- TOC entry 5819 (class 1259 OID 105022)
-- Name: idx_apontamento_producao_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_apontamento_producao_status ON public.apontamento_producao USING btree (status, id_maquina);


--
-- TOC entry 5820 (class 1259 OID 121404)
-- Name: idx_apontamento_produto; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_apontamento_produto ON public.apontamento_producao USING btree (id_produto);


--
-- TOC entry 5865 (class 1259 OID 74355)
-- Name: idx_apontamento_pulsos_maquina; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_apontamento_pulsos_maquina ON public.apontamento_pulsos USING btree (id_maquina);


--
-- TOC entry 5866 (class 1259 OID 105023)
-- Name: idx_apontamento_pulsos_maquina_data; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_apontamento_pulsos_maquina_data ON public.apontamento_pulsos USING btree (id_maquina, "timestamp");


--
-- TOC entry 5867 (class 1259 OID 74356)
-- Name: idx_apontamento_pulsos_timestamp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_apontamento_pulsos_timestamp ON public.apontamento_pulsos USING btree ("timestamp");


--
-- TOC entry 6018 (class 1259 OID 6055243)
-- Name: idx_bloqueio_data; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bloqueio_data ON public.separacao_itens_bloqueio USING btree (data_bloqueio DESC);


--
-- TOC entry 6019 (class 1259 OID 6055242)
-- Name: idx_bloqueio_operador; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bloqueio_operador ON public.separacao_itens_bloqueio USING btree (bloqueado_por);


--
-- TOC entry 6020 (class 1259 OID 6055241)
-- Name: idx_bloqueio_pedido; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bloqueio_pedido ON public.separacao_itens_bloqueio USING btree (pedidovendaid);


--
-- TOC entry 6069 (class 1259 OID 14395588)
-- Name: idx_carga_maquina_auditoria_programacao; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_carga_maquina_auditoria_programacao ON public.carga_maquina_auditoria USING btree (id_carga_maquina, created_at DESC);


--
-- TOC entry 6052 (class 1259 OID 14395533)
-- Name: idx_carga_maquina_maquina; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_carga_maquina_maquina ON public.carga_maquina USING btree (id_maquina, data_inicio, data_fim);


--
-- TOC entry 6053 (class 1259 OID 14396442)
-- Name: idx_carga_maquina_op; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_carga_maquina_op ON public.carga_maquina USING btree (id_ordem_producao);


--
-- TOC entry 6054 (class 1259 OID 14396441)
-- Name: idx_carga_maquina_periodo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_carga_maquina_periodo ON public.carga_maquina USING btree (id_maquina, data_inicio, data_fim);


--
-- TOC entry 6055 (class 1259 OID 14395535)
-- Name: idx_carga_maquina_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_carga_maquina_status ON public.carga_maquina USING btree (status);


--
-- TOC entry 5909 (class 1259 OID 75064)
-- Name: idx_checklist_execucoes_data_hora; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_checklist_execucoes_data_hora ON public.checklist_execucoes USING btree (data_hora DESC);


--
-- TOC entry 5910 (class 1259 OID 75063)
-- Name: idx_checklist_execucoes_maquina_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_checklist_execucoes_maquina_id ON public.checklist_execucoes USING btree (maquina_id);


--
-- TOC entry 5870 (class 1259 OID 74381)
-- Name: idx_consultas_operador; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_consultas_operador ON public.consultas_ia USING btree (id_operador);


--
-- TOC entry 5895 (class 1259 OID 16653539)
-- Name: idx_contagem_estoque_posicao_produto; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_contagem_estoque_posicao_produto ON public.contagem_estoque USING btree (id_posicao, id_produto, quantidade_pacotes DESC);


--
-- TOC entry 5896 (class 1259 OID 16653538)
-- Name: idx_contagem_estoque_produto_inventario; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_contagem_estoque_produto_inventario ON public.contagem_estoque USING btree (id_produto, id_inventario, quantidade_pacotes DESC);


--
-- TOC entry 6111 (class 1259 OID 16713151)
-- Name: idx_divergencias_data; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_divergencias_data ON public.divergencias_estoque USING btree (data_detecao DESC);


--
-- TOC entry 6112 (class 1259 OID 16713152)
-- Name: idx_divergencias_item; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_divergencias_item ON public.divergencias_estoque USING btree (pedidovendaitemid);


--
-- TOC entry 6113 (class 1259 OID 16713149)
-- Name: idx_divergencias_nota; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_divergencias_nota ON public.divergencias_estoque USING btree (nr_nota_fiscal);


--
-- TOC entry 6114 (class 1259 OID 16713150)
-- Name: idx_divergencias_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_divergencias_status ON public.divergencias_estoque USING btree (status);


--
-- TOC entry 6005 (class 1259 OID 3943754)
-- Name: idx_entrada_producao_itens_entrada; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_entrada_producao_itens_entrada ON public.entrada_producao_itens USING btree (id_entrada_producao);


--
-- TOC entry 6006 (class 1259 OID 3943755)
-- Name: idx_entrada_producao_itens_posicao; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_entrada_producao_itens_posicao ON public.entrada_producao_itens USING btree (id_posicao);


--
-- TOC entry 6000 (class 1259 OID 3943753)
-- Name: idx_entrada_producao_kardexid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_entrada_producao_kardexid ON public.entrada_producao USING btree (kardexid);


--
-- TOC entry 6001 (class 1259 OID 3943752)
-- Name: idx_entrada_producao_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_entrada_producao_status ON public.entrada_producao USING btree (status);


--
-- TOC entry 6040 (class 1259 OID 9967762)
-- Name: idx_est_aud_evento_data; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_est_aud_evento_data ON public.estoque_auditoria_eventos USING btree (data_evento DESC);


--
-- TOC entry 6041 (class 1259 OID 9967765)
-- Name: idx_est_aud_operador; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_est_aud_operador ON public.estoque_auditoria_eventos USING btree (id_operador);


--
-- TOC entry 6042 (class 1259 OID 9967764)
-- Name: idx_est_aud_posicao; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_est_aud_posicao ON public.estoque_auditoria_eventos USING btree (id_posicao);


--
-- TOC entry 6043 (class 1259 OID 9967763)
-- Name: idx_est_aud_produto; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_est_aud_produto ON public.estoque_auditoria_eventos USING btree (id_produto);


--
-- TOC entry 6044 (class 1259 OID 9967766)
-- Name: idx_est_aud_referencia; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_est_aud_referencia ON public.estoque_auditoria_eventos USING btree (referencia_movimento, id_referencia);


--
-- TOC entry 6045 (class 1259 OID 9967767)
-- Name: idx_est_aud_txid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_est_aud_txid ON public.estoque_auditoria_eventos USING btree (txid);


--
-- TOC entry 6032 (class 1259 OID 9402055)
-- Name: idx_est_mov_data; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_est_mov_data ON public.estoque_movimentacoes USING btree (data_movimentacao DESC);


--
-- TOC entry 6033 (class 1259 OID 9402057)
-- Name: idx_est_mov_operador; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_est_mov_operador ON public.estoque_movimentacoes USING btree (id_operador);


--
-- TOC entry 6034 (class 1259 OID 9402056)
-- Name: idx_est_mov_produto; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_est_mov_produto ON public.estoque_movimentacoes USING btree (id_produto);


--
-- TOC entry 6081 (class 1259 OID 16356140)
-- Name: idx_estrutura_produtos_componente_cache; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_estrutura_produtos_componente_cache ON public.estrutura_produtos USING btree (id_componente_cache);


--
-- TOC entry 6082 (class 1259 OID 16356138)
-- Name: idx_estrutura_produtos_componente_local; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_estrutura_produtos_componente_local ON public.estrutura_produtos USING btree (id_componente_local);


--
-- TOC entry 6083 (class 1259 OID 16356139)
-- Name: idx_estrutura_produtos_produto_cache; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_estrutura_produtos_produto_cache ON public.estrutura_produtos USING btree (id_produto_cache);


--
-- TOC entry 6084 (class 1259 OID 16356137)
-- Name: idx_estrutura_produtos_produto_local; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_estrutura_produtos_produto_local ON public.estrutura_produtos USING btree (id_produto_local);


--
-- TOC entry 6075 (class 1259 OID 15493614)
-- Name: idx_grupo_empresa; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_grupo_empresa ON public.grupoproduto USING btree (empresaid);


--
-- TOC entry 5859 (class 1259 OID 74320)
-- Name: idx_historico_manutencao_planejamento; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_historico_manutencao_planejamento ON public.historico_manutencoes USING btree (id_planejamento);


--
-- TOC entry 5860 (class 1259 OID 74321)
-- Name: idx_historico_manutencao_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_historico_manutencao_status ON public.historico_manutencoes USING btree (status);


--
-- TOC entry 6119 (class 1259 OID 16727655)
-- Name: idx_logs_sistema_data; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_logs_sistema_data ON public.logs_sistema USING btree (data_criacao DESC);


--
-- TOC entry 6059 (class 1259 OID 14395566)
-- Name: idx_maquina_molde_maquina; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_maquina_molde_maquina ON public.maquina_molde USING btree (id_maquina, ativo);


--
-- TOC entry 5939 (class 1259 OID 105056)
-- Name: idx_oee_apontamento; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_oee_apontamento ON public.oee_calculado USING btree (id_apontamento);


--
-- TOC entry 5940 (class 1259 OID 105055)
-- Name: idx_oee_maquina_data; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_oee_maquina_data ON public.oee_calculado USING btree (id_maquina, data_calculo);


--
-- TOC entry 6087 (class 1259 OID 16372788)
-- Name: idx_op_estrutura_itens_ordem; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_op_estrutura_itens_ordem ON public.ordem_producao_estrutura_itens USING btree (id_ordem_producao, nivel);


--
-- TOC entry 6088 (class 1259 OID 16372789)
-- Name: idx_op_estrutura_itens_raiz; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_op_estrutura_itens_raiz ON public.ordem_producao_estrutura_itens USING btree (id_ordem_raiz);


--
-- TOC entry 6091 (class 1259 OID 16372790)
-- Name: idx_op_necessidades_ordem; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_op_necessidades_ordem ON public.ordem_producao_necessidades USING btree (id_ordem_producao, status);


--
-- TOC entry 6092 (class 1259 OID 16372791)
-- Name: idx_op_necessidades_raiz; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_op_necessidades_raiz ON public.ordem_producao_necessidades USING btree (id_ordem_raiz);


--
-- TOC entry 5830 (class 1259 OID 65939)
-- Name: idx_operadores_faces_operador_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_operadores_faces_operador_id ON public.operadores_faces USING btree (operador_id);


--
-- TOC entry 5961 (class 1259 OID 194601)
-- Name: idx_operadores_status_online; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_operadores_status_online ON public.operadores_status USING btree (online);


--
-- TOC entry 5962 (class 1259 OID 194602)
-- Name: idx_operadores_status_operador; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_operadores_status_operador ON public.operadores_status USING btree (operador_id);


--
-- TOC entry 5823 (class 1259 OID 16372787)
-- Name: idx_ordem_producao_hierarquia; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ordem_producao_hierarquia ON public.ordem_producao USING btree (id_ordem_raiz, id_ordem_pai, nivel_estrutura);


--
-- TOC entry 6070 (class 1259 OID 15130978)
-- Name: idx_pedido_itens_aworks_simples_mv_item; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_pedido_itens_aworks_simples_mv_item ON public.pedido_itens_aworks_simples_mv USING btree (pedidovendaitemid);


--
-- TOC entry 6071 (class 1259 OID 15130979)
-- Name: idx_pedido_itens_aworks_simples_mv_pedido; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pedido_itens_aworks_simples_mv_pedido ON public.pedido_itens_aworks_simples_mv USING btree (pedidovendaid);


--
-- TOC entry 6072 (class 1259 OID 15130980)
-- Name: idx_pedido_itens_aworks_simples_mv_saldo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pedido_itens_aworks_simples_mv_saldo ON public.pedido_itens_aworks_simples_mv USING btree (pedidovendaid, quantidade_entrega, quantidade_despachada);


--
-- TOC entry 6035 (class 1259 OID 9861896)
-- Name: idx_pedidos_despacho_mv_data_faturamento; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pedidos_despacho_mv_data_faturamento ON public.pedidos_prontos_despacho_mv USING btree (dt_faturamento_pedidovenda);


--
-- TOC entry 6036 (class 1259 OID 9861897)
-- Name: idx_pedidos_despacho_mv_filial; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pedidos_despacho_mv_filial ON public.pedidos_prontos_despacho_mv USING btree (filialid);


--
-- TOC entry 6037 (class 1259 OID 9861895)
-- Name: idx_pedidos_despacho_mv_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_pedidos_despacho_mv_id ON public.pedidos_prontos_despacho_mv USING btree (id);


--
-- TOC entry 5849 (class 1259 OID 74318)
-- Name: idx_planejamento_maquina_periodo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_planejamento_maquina_periodo ON public.planejamento_producao USING btree (id_maquina, data_inicio, data_fim) WHERE ((status)::text <> ALL ((ARRAY['cancelado'::character varying, 'concluido'::character varying])::text[]));


--
-- TOC entry 5850 (class 1259 OID 74319)
-- Name: idx_planejamento_tipo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_planejamento_tipo ON public.planejamento_producao USING btree (tipo);


--
-- TOC entry 6046 (class 1259 OID 11428079)
-- Name: idx_produtos_cache_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_produtos_cache_id ON public.produtos_cache USING btree (id);


--
-- TOC entry 6047 (class 1259 OID 11428082)
-- Name: idx_produtos_cache_peso_bruto; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produtos_cache_peso_bruto ON public.produtos_cache USING btree (vl_pesobruto_produto);


--
-- TOC entry 6048 (class 1259 OID 11428080)
-- Name: idx_produtos_cache_referencia; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produtos_cache_referencia ON public.produtos_cache USING btree (referencia);


--
-- TOC entry 6049 (class 1259 OID 11428081)
-- Name: idx_produtos_cache_tp_produto; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produtos_cache_tp_produto ON public.produtos_cache USING btree (tp_produto);


--
-- TOC entry 5933 (class 1259 OID 90773)
-- Name: idx_produtos_ean14_ean14; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produtos_ean14_ean14 ON public.produtos_ean14 USING btree (ean14);


--
-- TOC entry 5934 (class 1259 OID 90772)
-- Name: idx_produtos_ean14_id_produto; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produtos_ean14_id_produto ON public.produtos_ean14 USING btree (id_produto);


--
-- TOC entry 5805 (class 1259 OID 15495378)
-- Name: idx_produtos_grupoprodutoid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produtos_grupoprodutoid ON public.produtos USING btree (grupoprodutoid);


--
-- TOC entry 5806 (class 1259 OID 16357213)
-- Name: idx_produtos_id_cache_vinculo_estrutura; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produtos_id_cache_vinculo_estrutura ON public.produtos USING btree (id_cache);


--
-- TOC entry 5807 (class 1259 OID 15495377)
-- Name: idx_produtos_subgrupoprodutoid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produtos_subgrupoprodutoid ON public.produtos USING btree (subgrupoprodutoid);


--
-- TOC entry 5808 (class 1259 OID 6839748)
-- Name: idx_produtos_tp_produto; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produtos_tp_produto ON public.produtos USING btree (tp_produto);


--
-- TOC entry 5809 (class 1259 OID 11427641)
-- Name: idx_produtos_vl_pesobruto_produto; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_produtos_vl_pesobruto_produto ON public.produtos USING btree (vl_pesobruto_produto);


--
-- TOC entry 5967 (class 1259 OID 3089234)
-- Name: idx_pulse_collection_id; Type: INDEX; Schema: public; Owner: metabase_user
--

CREATE INDEX idx_pulse_collection_id ON public.pulse USING btree (collection_id);


--
-- TOC entry 5968 (class 1259 OID 3089235)
-- Name: idx_pulse_creator_id; Type: INDEX; Schema: public; Owner: metabase_user
--

CREATE INDEX idx_pulse_creator_id ON public.pulse USING btree (creator_id);


--
-- TOC entry 5992 (class 1259 OID 3846807)
-- Name: idx_relatorios_falta_data; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_relatorios_falta_data ON public.relatorios_falta_estoque USING btree (data_relatorio DESC);


--
-- TOC entry 5993 (class 1259 OID 3846806)
-- Name: idx_relatorios_falta_operador; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_relatorios_falta_operador ON public.relatorios_falta_estoque USING btree (id_operador);


--
-- TOC entry 5994 (class 1259 OID 3846805)
-- Name: idx_relatorios_falta_pedido; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_relatorios_falta_pedido ON public.relatorios_falta_estoque USING btree (pedidovendaid);


--
-- TOC entry 5995 (class 1259 OID 3846804)
-- Name: idx_relatorios_falta_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_relatorios_falta_status ON public.relatorios_falta_estoque USING btree (status);


--
-- TOC entry 6097 (class 1259 OID 16424345)
-- Name: idx_requisicao_produto; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_requisicao_produto ON public.requisicao_compra USING btree (id_produto);


--
-- TOC entry 6098 (class 1259 OID 16424344)
-- Name: idx_requisicao_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_requisicao_status ON public.requisicao_compra USING btree (status);


--
-- TOC entry 6007 (class 1259 OID 4333175)
-- Name: idx_reservas_ativas; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reservas_ativas ON public.reservas_estoque USING btree (status, prioridade_pedido, data_reserva) WHERE ((status)::text = 'ATIVA'::text);


--
-- TOC entry 6008 (class 1259 OID 4333174)
-- Name: idx_reservas_data; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reservas_data ON public.reservas_estoque USING btree (data_reserva);


--
-- TOC entry 6009 (class 1259 OID 4333170)
-- Name: idx_reservas_item; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reservas_item ON public.reservas_estoque USING btree (pedidovendaitemid);


--
-- TOC entry 6010 (class 1259 OID 4333169)
-- Name: idx_reservas_pedido; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reservas_pedido ON public.reservas_estoque USING btree (pedidovendaid);


--
-- TOC entry 6011 (class 1259 OID 4333171)
-- Name: idx_reservas_posicao; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reservas_posicao ON public.reservas_estoque USING btree (id_posicao);


--
-- TOC entry 6012 (class 1259 OID 4333173)
-- Name: idx_reservas_prioridade; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reservas_prioridade ON public.reservas_estoque USING btree (prioridade_pedido);


--
-- TOC entry 6013 (class 1259 OID 4333172)
-- Name: idx_reservas_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_reservas_status ON public.reservas_estoque USING btree (status);


--
-- TOC entry 6025 (class 1259 OID 6060477)
-- Name: idx_saidas_log_data; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_saidas_log_data ON public.entrada_producao_saidas_log USING btree (dt_saida);


--
-- TOC entry 6026 (class 1259 OID 6060474)
-- Name: idx_saidas_log_kardex; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_saidas_log_kardex ON public.entrada_producao_saidas_log USING btree (kardexid_saida);


--
-- TOC entry 6027 (class 1259 OID 6060476)
-- Name: idx_saidas_log_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_saidas_log_status ON public.entrada_producao_saidas_log USING btree (status);


--
-- TOC entry 5981 (class 1259 OID 3236294)
-- Name: idx_sep_itens_pedido; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sep_itens_pedido ON public.separacao_itens USING btree (pedidovendaitemid);


--
-- TOC entry 5982 (class 1259 OID 3236296)
-- Name: idx_sep_itens_posicao; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sep_itens_posicao ON public.separacao_itens USING btree (id_posicao);


--
-- TOC entry 5983 (class 1259 OID 3236295)
-- Name: idx_sep_itens_produto; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sep_itens_produto ON public.separacao_itens USING btree (id_produto);


--
-- TOC entry 5984 (class 1259 OID 3236297)
-- Name: idx_sep_itens_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sep_itens_status ON public.separacao_itens USING btree (status);


--
-- TOC entry 5985 (class 1259 OID 6054836)
-- Name: idx_separacao_itens_bloqueado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_separacao_itens_bloqueado ON public.separacao_itens USING btree (bloqueado_por);


--
-- TOC entry 5986 (class 1259 OID 3279515)
-- Name: idx_separacao_itens_pedido; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_separacao_itens_pedido ON public.separacao_itens USING btree (id_separacao_pedido);


--
-- TOC entry 5987 (class 1259 OID 16653738)
-- Name: idx_separacao_itens_pedido_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_separacao_itens_pedido_status ON public.separacao_itens USING btree (id_separacao_pedido, status, quantidade_separada);


--
-- TOC entry 5988 (class 1259 OID 3279517)
-- Name: idx_separacao_itens_produtoid; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_separacao_itens_produtoid ON public.separacao_itens USING btree (produtoid);


--
-- TOC entry 5989 (class 1259 OID 3279516)
-- Name: idx_separacao_itens_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_separacao_itens_status ON public.separacao_itens USING btree (status);


--
-- TOC entry 5973 (class 1259 OID 3236234)
-- Name: idx_separacao_operador; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_separacao_operador ON public.separacao_pedidos USING btree (id_operador);


--
-- TOC entry 5974 (class 1259 OID 3811434)
-- Name: idx_separacao_pedidos_data_prioridade; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_separacao_pedidos_data_prioridade ON public.separacao_pedidos USING btree (data_prioridade_separacao);


--
-- TOC entry 5975 (class 1259 OID 16653745)
-- Name: idx_separacao_pedidos_status_data; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_separacao_pedidos_status_data ON public.separacao_pedidos USING btree (status, data_prioridade_separacao);


--
-- TOC entry 5976 (class 1259 OID 3236233)
-- Name: idx_separacao_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_separacao_status ON public.separacao_pedidos USING btree (status);


--
-- TOC entry 6064 (class 1259 OID 14395577)
-- Name: idx_setup_maquina_lookup; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_setup_maquina_lookup ON public.setup_maquina USING btree (id_maquina, cor_origem, cor_destino, material_origem, material_destino);


--
-- TOC entry 6076 (class 1259 OID 15493613)
-- Name: idx_subgrupo_grupo; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_subgrupo_grupo ON public.subgrupoproduto USING btree (grupoprodutoid);


--
-- TOC entry 6002 (class 1259 OID 6852801)
-- Name: idx_unique_entrada_prod_ativo_kardex_produto; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_unique_entrada_prod_ativo_kardex_produto ON public.entrada_producao USING btree (kardexid, produtoid) WHERE ((status)::text = ANY ((ARRAY['PENDENTE'::character varying, 'EM_RECEBIMENTO'::character varying])::text[]));


--
-- TOC entry 6115 (class 1259 OID 16713238)
-- Name: idx_vw_analise_separacao_mv_divergente; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vw_analise_separacao_mv_divergente ON public.vw_analise_separacao_mv USING btree (divergente) WHERE (divergente = true);


--
-- TOC entry 6116 (class 1259 OID 16713236)
-- Name: idx_vw_analise_separacao_mv_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_vw_analise_separacao_mv_id ON public.vw_analise_separacao_mv USING btree (pedidovendaitemid);


--
-- TOC entry 6117 (class 1259 OID 16713237)
-- Name: idx_vw_analise_separacao_mv_nota; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vw_analise_separacao_mv_nota ON public.vw_analise_separacao_mv USING btree (nr_nota_fiscal);


--
-- TOC entry 6118 (class 1259 OID 16713239)
-- Name: idx_vw_analise_separacao_mv_pedido; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vw_analise_separacao_mv_pedido ON public.vw_analise_separacao_mv USING btree (pedidovendaid);


--
-- TOC entry 6106 (class 1259 OID 16640397)
-- Name: idx_vw_separacao_completa_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_vw_separacao_completa_id ON public.vw_separacao_pedidos_completa USING btree (id);


--
-- TOC entry 6107 (class 1259 OID 16640399)
-- Name: idx_vw_separacao_completa_prioridade; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vw_separacao_completa_prioridade ON public.vw_separacao_pedidos_completa USING btree (prioridade_separacao);


--
-- TOC entry 6108 (class 1259 OID 16640398)
-- Name: idx_vw_separacao_completa_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vw_separacao_completa_status ON public.vw_separacao_pedidos_completa USING btree (status);


--
-- TOC entry 6103 (class 1259 OID 16639929)
-- Name: idx_vw_separacao_pedidos_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_vw_separacao_pedidos_id ON public.vw_separacao_pedidos_rapida USING btree (id);


--
-- TOC entry 6104 (class 1259 OID 16639931)
-- Name: idx_vw_separacao_pedidos_prioridade; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vw_separacao_pedidos_prioridade ON public.vw_separacao_pedidos_rapida USING btree (prioridade_separacao);


--
-- TOC entry 6105 (class 1259 OID 16639930)
-- Name: idx_vw_separacao_pedidos_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vw_separacao_pedidos_status ON public.vw_separacao_pedidos_rapida USING btree (status);


--
-- TOC entry 6372 (class 2618 OID 74360)
-- Name: view_pulsos_apontamento _RETURN; Type: RULE; Schema: public; Owner: postgres
--

CREATE OR REPLACE VIEW public.view_pulsos_apontamento AS
 SELECT a.id AS id_apontamento,
    m.descricao AS maquina,
    o.nome AS operador,
    sum(p.pulsos) AS total_pulsos,
    a.data_inicio,
    a.data_fim
   FROM (((public.apontamento_pulsos p
     JOIN public.apontamento_producao a ON ((p.id_apontamento = a.id)))
     JOIN public.maquinas m ON ((p.id_maquina = m.id)))
     LEFT JOIN public.operadores o ON ((p.id_operador = o.id)))
  GROUP BY a.id, m.descricao, o.nome;


--
-- TOC entry 6221 (class 2620 OID 74307)
-- Name: planejamento_producao tr_calcular_tempo_troca_molde; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tr_calcular_tempo_troca_molde BEFORE INSERT OR UPDATE ON public.planejamento_producao FOR EACH ROW EXECUTE FUNCTION public.calcular_tempo_troca_molde();


--
-- TOC entry 6219 (class 2620 OID 74190)
-- Name: moldes tr_valida_atualizacao_maquina; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tr_valida_atualizacao_maquina BEFORE UPDATE OF id_maquina ON public.moldes FOR EACH ROW EXECUTE FUNCTION public.valida_atualizacao_maquina();


--
-- TOC entry 6220 (class 2620 OID 74158)
-- Name: moldes tr_valida_maquina_injetora; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tr_valida_maquina_injetora BEFORE INSERT OR UPDATE ON public.moldes FOR EACH ROW EXECUTE FUNCTION public.valida_maquina_injetora();


--
-- TOC entry 6222 (class 2620 OID 74303)
-- Name: planejamento_producao tr_validar_conflito_agendamento; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER tr_validar_conflito_agendamento BEFORE INSERT OR UPDATE ON public.planejamento_producao FOR EACH ROW EXECUTE FUNCTION public.validar_conflito_agendamento();


--
-- TOC entry 6223 (class 2620 OID 74598)
-- Name: contagem_estoque trg_atualizar_cache; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_atualizar_cache AFTER INSERT OR DELETE OR UPDATE ON public.contagem_estoque FOR EACH STATEMENT EXECUTE FUNCTION public.trigger_atualizar_cache();


--
-- TOC entry 6224 (class 2620 OID 9968461)
-- Name: contagem_estoque trg_auditar_contagem_estoque; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_auditar_contagem_estoque AFTER INSERT OR DELETE OR UPDATE ON public.contagem_estoque FOR EACH ROW EXECUTE FUNCTION public.fn_auditar_contagem_estoque();


--
-- TOC entry 6226 (class 2620 OID 4333187)
-- Name: reservas_estoque trigger_atualizar_reservas; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_atualizar_reservas BEFORE UPDATE ON public.reservas_estoque FOR EACH ROW EXECUTE FUNCTION public.atualizar_data_reservas();


--
-- TOC entry 6225 (class 2620 OID 3846842)
-- Name: relatorios_falta_estoque trigger_update_relatorios_falta_timestamp; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trigger_update_relatorios_falta_timestamp BEFORE UPDATE ON public.relatorios_falta_estoque FOR EACH ROW EXECUTE FUNCTION public.update_relatorios_falta_timestamp();


--
-- TOC entry 6218 (class 2620 OID 100276)
-- Name: produtos update_produtos_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_produtos_updated_at BEFORE UPDATE ON public.produtos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 6124 (class 2606 OID 49480)
-- Name: apontamento_producao apontamento_producao_id_maquina_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.apontamento_producao
    ADD CONSTRAINT apontamento_producao_id_maquina_fkey FOREIGN KEY (id_maquina) REFERENCES public.maquinas(id);


--
-- TOC entry 6125 (class 2606 OID 13447068)
-- Name: apontamento_producao apontamento_producao_id_molde_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.apontamento_producao
    ADD CONSTRAINT apontamento_producao_id_molde_fkey FOREIGN KEY (id_molde) REFERENCES public.moldes(id);


--
-- TOC entry 6126 (class 2606 OID 13447073)
-- Name: apontamento_producao apontamento_producao_id_molde_versao_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.apontamento_producao
    ADD CONSTRAINT apontamento_producao_id_molde_versao_fkey FOREIGN KEY (id_molde_versao) REFERENCES public.moldes_versoes(id);


--
-- TOC entry 6127 (class 2606 OID 65902)
-- Name: apontamento_producao apontamento_producao_id_motivo_refugo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.apontamento_producao
    ADD CONSTRAINT apontamento_producao_id_motivo_refugo_fkey FOREIGN KEY (id_motivo_refugo) REFERENCES public.motivos_refugo(id);


--
-- TOC entry 6128 (class 2606 OID 49475)
-- Name: apontamento_producao apontamento_producao_id_operador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.apontamento_producao
    ADD CONSTRAINT apontamento_producao_id_operador_fkey FOREIGN KEY (id_operador) REFERENCES public.operadores(id);


--
-- TOC entry 6129 (class 2606 OID 57654)
-- Name: apontamento_producao apontamento_producao_id_ordem_producao_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.apontamento_producao
    ADD CONSTRAINT apontamento_producao_id_ordem_producao_fkey FOREIGN KEY (id_ordem_producao) REFERENCES public.ordem_producao(id);


--
-- TOC entry 6130 (class 2606 OID 49485)
-- Name: apontamento_producao apontamento_producao_id_produto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.apontamento_producao
    ADD CONSTRAINT apontamento_producao_id_produto_fkey FOREIGN KEY (id_produto) REFERENCES public.produtos(id);


--
-- TOC entry 6148 (class 2606 OID 74345)
-- Name: apontamento_pulsos apontamento_pulsos_id_apontamento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.apontamento_pulsos
    ADD CONSTRAINT apontamento_pulsos_id_apontamento_fkey FOREIGN KEY (id_apontamento) REFERENCES public.apontamento_producao(id);


--
-- TOC entry 6149 (class 2606 OID 74340)
-- Name: apontamento_pulsos apontamento_pulsos_id_maquina_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.apontamento_pulsos
    ADD CONSTRAINT apontamento_pulsos_id_maquina_fkey FOREIGN KEY (id_maquina) REFERENCES public.maquinas(id);


--
-- TOC entry 6150 (class 2606 OID 74350)
-- Name: apontamento_pulsos apontamento_pulsos_id_operador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.apontamento_pulsos
    ADD CONSTRAINT apontamento_pulsos_id_operador_fkey FOREIGN KEY (id_operador) REFERENCES public.operadores(id);


--
-- TOC entry 6191 (class 2606 OID 191479)
-- Name: chat_mensagens chat_mensagens_operador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_mensagens
    ADD CONSTRAINT chat_mensagens_operador_id_fkey FOREIGN KEY (operador_id) REFERENCES public.operadores(id);


--
-- TOC entry 6192 (class 2606 OID 191474)
-- Name: chat_mensagens chat_mensagens_sala_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_mensagens
    ADD CONSTRAINT chat_mensagens_sala_id_fkey FOREIGN KEY (sala_id) REFERENCES public.chat_salas(id);


--
-- TOC entry 6193 (class 2606 OID 191503)
-- Name: chat_notificacoes chat_notificacoes_mensagem_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_notificacoes
    ADD CONSTRAINT chat_notificacoes_mensagem_id_fkey FOREIGN KEY (mensagem_id) REFERENCES public.chat_mensagens(id);


--
-- TOC entry 6194 (class 2606 OID 191493)
-- Name: chat_notificacoes chat_notificacoes_operador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_notificacoes
    ADD CONSTRAINT chat_notificacoes_operador_id_fkey FOREIGN KEY (operador_id) REFERENCES public.operadores(id);


--
-- TOC entry 6195 (class 2606 OID 191498)
-- Name: chat_notificacoes chat_notificacoes_sala_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_notificacoes
    ADD CONSTRAINT chat_notificacoes_sala_id_fkey FOREIGN KEY (sala_id) REFERENCES public.chat_salas(id);


--
-- TOC entry 6189 (class 2606 OID 191457)
-- Name: chat_participantes chat_participantes_operador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_participantes
    ADD CONSTRAINT chat_participantes_operador_id_fkey FOREIGN KEY (operador_id) REFERENCES public.operadores(id);


--
-- TOC entry 6190 (class 2606 OID 191452)
-- Name: chat_participantes chat_participantes_sala_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_participantes
    ADD CONSTRAINT chat_participantes_sala_id_fkey FOREIGN KEY (sala_id) REFERENCES public.chat_salas(id);


--
-- TOC entry 6188 (class 2606 OID 191438)
-- Name: chat_salas chat_salas_criador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.chat_salas
    ADD CONSTRAINT chat_salas_criador_id_fkey FOREIGN KEY (criador_id) REFERENCES public.operadores(id);


--
-- TOC entry 6163 (class 2606 OID 75023)
-- Name: checklist_execucoes checklist_execucoes_maquina_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_execucoes
    ADD CONSTRAINT checklist_execucoes_maquina_id_fkey FOREIGN KEY (maquina_id) REFERENCES public.maquinas(id);


--
-- TOC entry 6164 (class 2606 OID 75033)
-- Name: checklist_execucoes checklist_execucoes_operador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_execucoes
    ADD CONSTRAINT checklist_execucoes_operador_id_fkey FOREIGN KEY (operador_id) REFERENCES public.operadores(id);


--
-- TOC entry 6165 (class 2606 OID 78761)
-- Name: checklist_execucoes checklist_execucoes_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_execucoes
    ADD CONSTRAINT checklist_execucoes_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.operadores(id);


--
-- TOC entry 6169 (class 2606 OID 78756)
-- Name: checklist_fotos checklist_fotos_checklist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_fotos
    ADD CONSTRAINT checklist_fotos_checklist_id_fkey FOREIGN KEY (checklist_id) REFERENCES public.checklist_execucoes(id);


--
-- TOC entry 6168 (class 2606 OID 75087)
-- Name: checklist_itens checklist_itens_modelo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_itens
    ADD CONSTRAINT checklist_itens_modelo_id_fkey FOREIGN KEY (modelo_id) REFERENCES public.checklist_modelos(id);


--
-- TOC entry 6166 (class 2606 OID 75047)
-- Name: checklist_respostas checklist_respostas_execucao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_respostas
    ADD CONSTRAINT checklist_respostas_execucao_id_fkey FOREIGN KEY (execucao_id) REFERENCES public.checklist_execucoes(id);


--
-- TOC entry 6167 (class 2606 OID 75057)
-- Name: checklist_respostas checklist_respostas_nao_conformidade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_respostas
    ADD CONSTRAINT checklist_respostas_nao_conformidade_id_fkey FOREIGN KEY (nao_conformidade_id) REFERENCES public.nao_conformidades(id);


--
-- TOC entry 6151 (class 2606 OID 74376)
-- Name: consultas_ia consultas_ia_id_operador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.consultas_ia
    ADD CONSTRAINT consultas_ia_id_operador_fkey FOREIGN KEY (id_operador) REFERENCES public.operadores(id);


--
-- TOC entry 6156 (class 2606 OID 74798)
-- Name: contagem_estoque contagem_estoque_id_inventario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.contagem_estoque
    ADD CONSTRAINT contagem_estoque_id_inventario_fkey FOREIGN KEY (id_inventario) REFERENCES public.inventario(id);


--
-- TOC entry 6157 (class 2606 OID 125727)
-- Name: contagem_estoque contagem_estoque_id_local_estoque_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.contagem_estoque
    ADD CONSTRAINT contagem_estoque_id_local_estoque_fkey FOREIGN KEY (id_local_estoque) REFERENCES public.locais_estoque(id);


--
-- TOC entry 6158 (class 2606 OID 74519)
-- Name: contagem_estoque contagem_estoque_id_operador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.contagem_estoque
    ADD CONSTRAINT contagem_estoque_id_operador_fkey FOREIGN KEY (id_operador) REFERENCES public.operadores(id);


--
-- TOC entry 6159 (class 2606 OID 74524)
-- Name: contagem_estoque contagem_estoque_id_posicao_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.contagem_estoque
    ADD CONSTRAINT contagem_estoque_id_posicao_fkey FOREIGN KEY (id_posicao) REFERENCES public.posicoes(id);


--
-- TOC entry 6160 (class 2606 OID 153720)
-- Name: contagem_estoque contagem_estoque_id_unidade_consumo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.contagem_estoque
    ADD CONSTRAINT contagem_estoque_id_unidade_consumo_fkey FOREIGN KEY (id_unidade_consumo) REFERENCES public.unidades(id);


--
-- TOC entry 6201 (class 2606 OID 3943747)
-- Name: entrada_producao_itens entrada_producao_itens_id_entrada_producao_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.entrada_producao_itens
    ADD CONSTRAINT entrada_producao_itens_id_entrada_producao_fkey FOREIGN KEY (id_entrada_producao) REFERENCES public.entrada_producao(id) ON DELETE CASCADE;


--
-- TOC entry 6177 (class 2606 OID 125732)
-- Name: estoque estoque_id_local_estoque_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estoque
    ADD CONSTRAINT estoque_id_local_estoque_fkey FOREIGN KEY (id_local_estoque) REFERENCES public.locais_estoque(id);


--
-- TOC entry 6178 (class 2606 OID 153715)
-- Name: estoque estoque_id_unidade_consumo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estoque
    ADD CONSTRAINT estoque_id_unidade_consumo_fkey FOREIGN KEY (id_unidade_consumo) REFERENCES public.unidades(id);


--
-- TOC entry 6179 (class 2606 OID 78939)
-- Name: estoque estoque_operador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estoque
    ADD CONSTRAINT estoque_operador_id_fkey FOREIGN KEY (operador_id) REFERENCES public.operadores(id);


--
-- TOC entry 6180 (class 2606 OID 78934)
-- Name: estoque estoque_posicao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estoque
    ADD CONSTRAINT estoque_posicao_id_fkey FOREIGN KEY (posicao_id) REFERENCES public.posicoes(id);


--
-- TOC entry 6181 (class 2606 OID 78929)
-- Name: estoque estoque_produto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estoque
    ADD CONSTRAINT estoque_produto_id_fkey FOREIGN KEY (produto_id) REFERENCES public.produtos(id);


--
-- TOC entry 6209 (class 2606 OID 14395547)
-- Name: agenda_maquina fk_agenda_carga; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agenda_maquina
    ADD CONSTRAINT fk_agenda_carga FOREIGN KEY (id_carga_maquina) REFERENCES public.carga_maquina(id) ON DELETE CASCADE;


--
-- TOC entry 6170 (class 2606 OID 78790)
-- Name: checklist_fotos fk_checklist; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.checklist_fotos
    ADD CONSTRAINT fk_checklist FOREIGN KEY (checklist_id) REFERENCES public.checklist_execucoes(id);


--
-- TOC entry 6211 (class 2606 OID 16356146)
-- Name: estrutura_produtos fk_estrutura_produtos_componente_local; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estrutura_produtos
    ADD CONSTRAINT fk_estrutura_produtos_componente_local FOREIGN KEY (id_componente_local) REFERENCES public.produtos(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- TOC entry 6212 (class 2606 OID 16356141)
-- Name: estrutura_produtos fk_estrutura_produtos_produto_local; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.estrutura_produtos
    ADD CONSTRAINT fk_estrutura_produtos_produto_local FOREIGN KEY (id_produto_local) REFERENCES public.produtos(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- TOC entry 6213 (class 2606 OID 16372755)
-- Name: ordem_producao_estrutura_itens fk_op_estrutura_item_ordem; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordem_producao_estrutura_itens
    ADD CONSTRAINT fk_op_estrutura_item_ordem FOREIGN KEY (id_ordem_producao) REFERENCES public.ordem_producao(id) ON DELETE CASCADE;


--
-- TOC entry 6214 (class 2606 OID 16372782)
-- Name: ordem_producao_necessidades fk_op_necessidade_op_filha; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordem_producao_necessidades
    ADD CONSTRAINT fk_op_necessidade_op_filha FOREIGN KEY (id_ordem_producao_filha) REFERENCES public.ordem_producao(id) ON DELETE SET NULL;


--
-- TOC entry 6215 (class 2606 OID 16372777)
-- Name: ordem_producao_necessidades fk_op_necessidade_ordem; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordem_producao_necessidades
    ADD CONSTRAINT fk_op_necessidade_ordem FOREIGN KEY (id_ordem_producao) REFERENCES public.ordem_producao(id) ON DELETE CASCADE;


--
-- TOC entry 6132 (class 2606 OID 74191)
-- Name: ordem_producao fk_ordem_molde; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordem_producao
    ADD CONSTRAINT fk_ordem_molde FOREIGN KEY (id_molde) REFERENCES public.moldes(id);


--
-- TOC entry 6202 (class 2606 OID 4333181)
-- Name: reservas_estoque fk_reservas_operador; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reservas_estoque
    ADD CONSTRAINT fk_reservas_operador FOREIGN KEY (id_operador_reserva) REFERENCES public.operadores(id);


--
-- TOC entry 6203 (class 2606 OID 4333176)
-- Name: reservas_estoque fk_reservas_posicao; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.reservas_estoque
    ADD CONSTRAINT fk_reservas_posicao FOREIGN KEY (id_posicao) REFERENCES public.posicoes(id);


--
-- TOC entry 6210 (class 2606 OID 15493608)
-- Name: subgrupoproduto fk_subgrupo_grupo; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subgrupoproduto
    ADD CONSTRAINT fk_subgrupo_grupo FOREIGN KEY (grupoprodutoid) REFERENCES public.grupoproduto(grupoprodutoid) ON DELETE CASCADE;


--
-- TOC entry 6145 (class 2606 OID 74297)
-- Name: historico_manutencoes historico_manutencoes_id_operador_responsavel_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historico_manutencoes
    ADD CONSTRAINT historico_manutencoes_id_operador_responsavel_fkey FOREIGN KEY (id_operador_responsavel) REFERENCES public.operadores(id);


--
-- TOC entry 6146 (class 2606 OID 74287)
-- Name: historico_manutencoes historico_manutencoes_id_planejamento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historico_manutencoes
    ADD CONSTRAINT historico_manutencoes_id_planejamento_fkey FOREIGN KEY (id_planejamento) REFERENCES public.planejamento_producao(id);


--
-- TOC entry 6147 (class 2606 OID 74292)
-- Name: historico_manutencoes historico_manutencoes_id_tipo_manutencao_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.historico_manutencoes
    ADD CONSTRAINT historico_manutencoes_id_tipo_manutencao_fkey FOREIGN KEY (id_tipo_manutencao) REFERENCES public.tipos_manutencao(id);


--
-- TOC entry 6161 (class 2606 OID 74787)
-- Name: inventario inventario_id_operador_abertura_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventario
    ADD CONSTRAINT inventario_id_operador_abertura_fkey FOREIGN KEY (id_operador_abertura) REFERENCES public.operadores(id);


--
-- TOC entry 6162 (class 2606 OID 74792)
-- Name: inventario inventario_id_operador_fechamento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventario
    ADD CONSTRAINT inventario_id_operador_fechamento_fkey FOREIGN KEY (id_operador_fechamento) REFERENCES public.operadores(id);


--
-- TOC entry 6135 (class 2606 OID 65875)
-- Name: logs_apontamento logs_apontamento_id_apontamento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.logs_apontamento
    ADD CONSTRAINT logs_apontamento_id_apontamento_fkey FOREIGN KEY (id_apontamento) REFERENCES public.apontamento_producao(id);


--
-- TOC entry 6136 (class 2606 OID 65880)
-- Name: logs_apontamento logs_apontamento_id_operador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.logs_apontamento
    ADD CONSTRAINT logs_apontamento_id_operador_fkey FOREIGN KEY (id_operador) REFERENCES public.operadores(id);


--
-- TOC entry 6182 (class 2606 OID 90793)
-- Name: logs_impressao logs_impressao_id_operador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.logs_impressao
    ADD CONSTRAINT logs_impressao_id_operador_fkey FOREIGN KEY (id_operador) REFERENCES public.operadores(id);


--
-- TOC entry 6152 (class 2606 OID 74478)
-- Name: modulos modulos_id_rua_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.modulos
    ADD CONSTRAINT modulos_id_rua_fkey FOREIGN KEY (id_rua) REFERENCES public.ruas(id);


--
-- TOC entry 6138 (class 2606 OID 74152)
-- Name: moldes moldes_id_maquina_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes
    ADD CONSTRAINT moldes_id_maquina_fkey FOREIGN KEY (id_maquina) REFERENCES public.maquinas(id);


--
-- TOC entry 6141 (class 2606 OID 74211)
-- Name: moldes_maquinas moldes_maquinas_id_maquina_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes_maquinas
    ADD CONSTRAINT moldes_maquinas_id_maquina_fkey FOREIGN KEY (id_maquina) REFERENCES public.maquinas(id) ON DELETE CASCADE;


--
-- TOC entry 6142 (class 2606 OID 74206)
-- Name: moldes_maquinas moldes_maquinas_id_molde_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes_maquinas
    ADD CONSTRAINT moldes_maquinas_id_molde_fkey FOREIGN KEY (id_molde) REFERENCES public.moldes(id) ON DELETE CASCADE;


--
-- TOC entry 6140 (class 2606 OID 74184)
-- Name: moldes_produtos moldes_produtos_id_versao_molde_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes_produtos
    ADD CONSTRAINT moldes_produtos_id_versao_molde_fkey FOREIGN KEY (id_versao_molde) REFERENCES public.moldes_versoes(id) ON DELETE CASCADE;


--
-- TOC entry 6139 (class 2606 OID 74169)
-- Name: moldes_versoes moldes_versoes_id_molde_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.moldes_versoes
    ADD CONSTRAINT moldes_versoes_id_molde_fkey FOREIGN KEY (id_molde) REFERENCES public.moldes(id) ON DELETE CASCADE;


--
-- TOC entry 6171 (class 2606 OID 78841)
-- Name: movimentacoes_estoque movimentacoes_estoque_id_inventario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimentacoes_estoque
    ADD CONSTRAINT movimentacoes_estoque_id_inventario_fkey FOREIGN KEY (id_inventario) REFERENCES public.inventario(id);


--
-- TOC entry 6172 (class 2606 OID 153876)
-- Name: movimentacoes_estoque movimentacoes_estoque_id_unidade_consumo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimentacoes_estoque
    ADD CONSTRAINT movimentacoes_estoque_id_unidade_consumo_fkey FOREIGN KEY (id_unidade_consumo) REFERENCES public.unidades(id);


--
-- TOC entry 6173 (class 2606 OID 153881)
-- Name: movimentacoes_estoque movimentacoes_estoque_id_unidade_entrada_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimentacoes_estoque
    ADD CONSTRAINT movimentacoes_estoque_id_unidade_entrada_fkey FOREIGN KEY (id_unidade_entrada) REFERENCES public.unidades(id);


--
-- TOC entry 6174 (class 2606 OID 78836)
-- Name: movimentacoes_estoque movimentacoes_estoque_operador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimentacoes_estoque
    ADD CONSTRAINT movimentacoes_estoque_operador_id_fkey FOREIGN KEY (operador_id) REFERENCES public.operadores(id);


--
-- TOC entry 6175 (class 2606 OID 78831)
-- Name: movimentacoes_estoque movimentacoes_estoque_posicao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimentacoes_estoque
    ADD CONSTRAINT movimentacoes_estoque_posicao_id_fkey FOREIGN KEY (posicao_id) REFERENCES public.posicoes(id);


--
-- TOC entry 6176 (class 2606 OID 78826)
-- Name: movimentacoes_estoque movimentacoes_estoque_tipo_movimentacao_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.movimentacoes_estoque
    ADD CONSTRAINT movimentacoes_estoque_tipo_movimentacao_id_fkey FOREIGN KEY (tipo_movimentacao_id) REFERENCES public.tipos_movimentacao(id);


--
-- TOC entry 6153 (class 2606 OID 74492)
-- Name: niveis niveis_id_modulo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.niveis
    ADD CONSTRAINT niveis_id_modulo_fkey FOREIGN KEY (id_modulo) REFERENCES public.modulos(id);


--
-- TOC entry 6183 (class 2606 OID 105050)
-- Name: oee_calculado oee_calculado_id_apontamento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oee_calculado
    ADD CONSTRAINT oee_calculado_id_apontamento_fkey FOREIGN KEY (id_apontamento) REFERENCES public.apontamento_producao(id);


--
-- TOC entry 6184 (class 2606 OID 105040)
-- Name: oee_calculado oee_calculado_id_maquina_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oee_calculado
    ADD CONSTRAINT oee_calculado_id_maquina_fkey FOREIGN KEY (id_maquina) REFERENCES public.maquinas(id);


--
-- TOC entry 6185 (class 2606 OID 105045)
-- Name: oee_calculado oee_calculado_id_produto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.oee_calculado
    ADD CONSTRAINT oee_calculado_id_produto_fkey FOREIGN KEY (id_produto) REFERENCES public.produtos(id);


--
-- TOC entry 6137 (class 2606 OID 65934)
-- Name: operadores_faces operadores_faces_operador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operadores_faces
    ADD CONSTRAINT operadores_faces_operador_id_fkey FOREIGN KEY (operador_id) REFERENCES public.operadores(id) ON DELETE CASCADE;


--
-- TOC entry 6196 (class 2606 OID 194596)
-- Name: operadores_status operadores_status_operador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.operadores_status
    ADD CONSTRAINT operadores_status_operador_id_fkey FOREIGN KEY (operador_id) REFERENCES public.operadores(id);


--
-- TOC entry 6133 (class 2606 OID 57649)
-- Name: ordem_producao ordem_producao_id_operador_responsavel_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordem_producao
    ADD CONSTRAINT ordem_producao_id_operador_responsavel_fkey FOREIGN KEY (id_operador_responsavel) REFERENCES public.operadores(id);


--
-- TOC entry 6134 (class 2606 OID 57644)
-- Name: ordem_producao ordem_producao_id_produto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ordem_producao
    ADD CONSTRAINT ordem_producao_id_produto_fkey FOREIGN KEY (id_produto) REFERENCES public.produtos(id);


--
-- TOC entry 6131 (class 2606 OID 49499)
-- Name: paradas_producao paradas_producao_id_apontamento_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paradas_producao
    ADD CONSTRAINT paradas_producao_id_apontamento_fkey FOREIGN KEY (id_apontamento) REFERENCES public.apontamento_producao(id);


--
-- TOC entry 6143 (class 2606 OID 74234)
-- Name: planejamento_producao planejamento_producao_id_maquina_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.planejamento_producao
    ADD CONSTRAINT planejamento_producao_id_maquina_fkey FOREIGN KEY (id_maquina) REFERENCES public.maquinas(id);


--
-- TOC entry 6144 (class 2606 OID 74229)
-- Name: planejamento_producao planejamento_producao_id_molde_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.planejamento_producao
    ADD CONSTRAINT planejamento_producao_id_molde_fkey FOREIGN KEY (id_molde) REFERENCES public.moldes(id);


--
-- TOC entry 6154 (class 2606 OID 125737)
-- Name: posicoes posicoes_id_local_estoque_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posicoes
    ADD CONSTRAINT posicoes_id_local_estoque_fkey FOREIGN KEY (id_local_estoque) REFERENCES public.locais_estoque(id);


--
-- TOC entry 6155 (class 2606 OID 74506)
-- Name: posicoes posicoes_id_nivel_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.posicoes
    ADD CONSTRAINT posicoes_id_nivel_fkey FOREIGN KEY (id_nivel) REFERENCES public.niveis(id);


--
-- TOC entry 6122 (class 2606 OID 153705)
-- Name: produtos produtos_id_unidade_compra_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.produtos
    ADD CONSTRAINT produtos_id_unidade_compra_fkey FOREIGN KEY (id_unidade_compra) REFERENCES public.unidades(id);


--
-- TOC entry 6123 (class 2606 OID 153710)
-- Name: produtos produtos_id_unidade_consumo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.produtos
    ADD CONSTRAINT produtos_id_unidade_consumo_fkey FOREIGN KEY (id_unidade_consumo) REFERENCES public.unidades(id);


--
-- TOC entry 6216 (class 2606 OID 16424339)
-- Name: requisicao_compra requisicao_compra_id_operador_compra_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.requisicao_compra
    ADD CONSTRAINT requisicao_compra_id_operador_compra_fkey FOREIGN KEY (id_operador_compra) REFERENCES public.operadores(id);


--
-- TOC entry 6217 (class 2606 OID 16424334)
-- Name: requisicao_compra requisicao_compra_id_produto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.requisicao_compra
    ADD CONSTRAINT requisicao_compra_id_produto_fkey FOREIGN KEY (id_produto) REFERENCES public.produtos(id);


--
-- TOC entry 6197 (class 2606 OID 6054831)
-- Name: separacao_itens separacao_itens_bloqueado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.separacao_itens
    ADD CONSTRAINT separacao_itens_bloqueado_por_fkey FOREIGN KEY (bloqueado_por) REFERENCES public.operadores(id) ON DELETE SET NULL;


--
-- TOC entry 6207 (class 2606 OID 6055231)
-- Name: separacao_itens_bloqueio separacao_itens_bloqueio_bloqueado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.separacao_itens_bloqueio
    ADD CONSTRAINT separacao_itens_bloqueio_bloqueado_por_fkey FOREIGN KEY (bloqueado_por) REFERENCES public.operadores(id) ON DELETE SET NULL;


--
-- TOC entry 6208 (class 2606 OID 6055236)
-- Name: separacao_itens_bloqueio separacao_itens_bloqueio_desbloqueado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.separacao_itens_bloqueio
    ADD CONSTRAINT separacao_itens_bloqueio_desbloqueado_por_fkey FOREIGN KEY (desbloqueado_por) REFERENCES public.operadores(id) ON DELETE SET NULL;


--
-- TOC entry 6198 (class 2606 OID 3236289)
-- Name: separacao_itens separacao_itens_id_posicao_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.separacao_itens
    ADD CONSTRAINT separacao_itens_id_posicao_fkey FOREIGN KEY (id_posicao) REFERENCES public.posicoes(id);


--
-- TOC entry 6199 (class 2606 OID 3236284)
-- Name: separacao_itens separacao_itens_id_produto_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.separacao_itens
    ADD CONSTRAINT separacao_itens_id_produto_fkey FOREIGN KEY (id_produto) REFERENCES public.produtos(id);


--
-- TOC entry 6200 (class 2606 OID 3236279)
-- Name: separacao_itens separacao_itens_id_separacao_pedido_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.separacao_itens
    ADD CONSTRAINT separacao_itens_id_separacao_pedido_fkey FOREIGN KEY (id_separacao_pedido) REFERENCES public.separacao_pedidos(id) ON DELETE CASCADE;


--
-- TOC entry 6204 (class 2606 OID 4766637)
-- Name: transferencias transferencias_id_contagem_destino_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transferencias
    ADD CONSTRAINT transferencias_id_contagem_destino_fkey FOREIGN KEY (id_contagem_destino) REFERENCES public.contagem_estoque(id);


--
-- TOC entry 6205 (class 2606 OID 4766632)
-- Name: transferencias transferencias_id_contagem_origem_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transferencias
    ADD CONSTRAINT transferencias_id_contagem_origem_fkey FOREIGN KEY (id_contagem_origem) REFERENCES public.contagem_estoque(id);


--
-- TOC entry 6206 (class 2606 OID 4766642)
-- Name: transferencias transferencias_id_operador_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.transferencias
    ADD CONSTRAINT transferencias_id_operador_fkey FOREIGN KEY (id_operador) REFERENCES public.operadores(id);


--
-- TOC entry 6186 (class 2606 OID 153694)
-- Name: unidade_conversao unidade_conversao_id_unidade_destino_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.unidade_conversao
    ADD CONSTRAINT unidade_conversao_id_unidade_destino_fkey FOREIGN KEY (id_unidade_destino) REFERENCES public.unidades(id);


--
-- TOC entry 6187 (class 2606 OID 153689)
-- Name: unidade_conversao unidade_conversao_id_unidade_origem_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.unidade_conversao
    ADD CONSTRAINT unidade_conversao_id_unidade_origem_fkey FOREIGN KEY (id_unidade_origem) REFERENCES public.unidades(id);


--
-- TOC entry 6409 (class 0 OID 0)
-- Dependencies: 114
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO metabase_user;


--
-- TOC entry 6410 (class 0 OID 0)
-- Dependencies: 702
-- Name: FUNCTION atualizar_data_reservas(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.atualizar_data_reservas() TO metabase_user;


--
-- TOC entry 6411 (class 0 OID 0)
-- Dependencies: 615
-- Name: FUNCTION atualizar_entradas_aworks(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.atualizar_entradas_aworks() TO metabase_user;


--
-- TOC entry 6412 (class 0 OID 0)
-- Dependencies: 583
-- Name: FUNCTION atualizar_grupo_subgrupo_produtos(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.atualizar_grupo_subgrupo_produtos() TO metabase_user;


--
-- TOC entry 6413 (class 0 OID 0)
-- Dependencies: 645
-- Name: FUNCTION atualizar_grupos_subgrupos(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.atualizar_grupos_subgrupos() TO metabase_user;


--
-- TOC entry 6414 (class 0 OID 0)
-- Dependencies: 660
-- Name: FUNCTION atualizar_pedido_itens_aworks_simples_mv(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.atualizar_pedido_itens_aworks_simples_mv() TO metabase_user;


--
-- TOC entry 6415 (class 0 OID 0)
-- Dependencies: 582
-- Name: FUNCTION atualizar_vw_analise_separacao_mv(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.atualizar_vw_analise_separacao_mv() TO metabase_user;


--
-- TOC entry 6416 (class 0 OID 0)
-- Dependencies: 618
-- Name: FUNCTION atualizar_vw_divergencias_mv(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.atualizar_vw_divergencias_mv() TO metabase_user;


--
-- TOC entry 6417 (class 0 OID 0)
-- Dependencies: 704
-- Name: FUNCTION atualizar_vw_separacao_pedidos(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.atualizar_vw_separacao_pedidos() TO metabase_user;


--
-- TOC entry 6419 (class 0 OID 0)
-- Dependencies: 584
-- Name: FUNCTION bloquear_item_separacao(p_pedidovendaitemid integer, p_id_operador integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.bloquear_item_separacao(p_pedidovendaitemid integer, p_id_operador integer) TO metabase_user;


--
-- TOC entry 6420 (class 0 OID 0)
-- Dependencies: 647
-- Name: FUNCTION buscar_divergencias_pendentes(p_limite integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.buscar_divergencias_pendentes(p_limite integer) TO metabase_user;


--
-- TOC entry 6422 (class 0 OID 0)
-- Dependencies: 669
-- Name: FUNCTION calcular_prioridade_pedido(p_pedidovendaid integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.calcular_prioridade_pedido(p_pedidovendaid integer) TO metabase_user;


--
-- TOC entry 6424 (class 0 OID 0)
-- Dependencies: 591
-- Name: FUNCTION desbloquear_item_separacao(p_pedidovendaitemid integer, p_id_operador integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.desbloquear_item_separacao(p_pedidovendaitemid integer, p_id_operador integer) TO metabase_user;


--
-- TOC entry 6425 (class 0 OID 0)
-- Dependencies: 694
-- Name: FUNCTION detectar_divergencias(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.detectar_divergencias() TO metabase_user;


--
-- TOC entry 6426 (class 0 OID 0)
-- Dependencies: 654
-- Name: FUNCTION diagnosticar_colunas_estrutura_aworks(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.diagnosticar_colunas_estrutura_aworks() TO metabase_user;


--
-- TOC entry 6427 (class 0 OID 0)
-- Dependencies: 633
-- Name: FUNCTION diagnosticar_id_cache_estrutura_aworks(p_id_cache integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.diagnosticar_id_cache_estrutura_aworks(p_id_cache integer) TO metabase_user;


--
-- TOC entry 6428 (class 0 OID 0)
-- Dependencies: 706
-- Name: FUNCTION expandir_campos_produtos_por_aworks(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.expandir_campos_produtos_por_aworks() TO metabase_user;


--
-- TOC entry 6430 (class 0 OID 0)
-- Dependencies: 566
-- Name: FUNCTION finalizar_separacao_parcial(p_pedidovendaitemid integer, p_quantidade_separada numeric, p_id_operador integer, p_observacao text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.finalizar_separacao_parcial(p_pedidovendaitemid integer, p_quantidade_separada numeric, p_id_operador integer, p_observacao text) TO metabase_user;


--
-- TOC entry 6431 (class 0 OID 0)
-- Dependencies: 642
-- Name: FUNCTION fn_auditar_contagem_estoque(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fn_auditar_contagem_estoque() TO metabase_user;


--
-- TOC entry 6432 (class 0 OID 0)
-- Dependencies: 559
-- Name: FUNCTION fn_obter_bigint_setting(p_setting text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fn_obter_bigint_setting(p_setting text) TO metabase_user;


--
-- TOC entry 6433 (class 0 OID 0)
-- Dependencies: 695
-- Name: FUNCTION fn_obter_int_setting(p_setting text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.fn_obter_int_setting(p_setting text) TO metabase_user;


--
-- TOC entry 6434 (class 0 OID 0)
-- Dependencies: 604
-- Name: FUNCTION gerar_numero_requisicao(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.gerar_numero_requisicao() TO metabase_user;


--
-- TOC entry 6435 (class 0 OID 0)
-- Dependencies: 681
-- Name: FUNCTION gerar_requisicoes_compra(p_horizonte_dias integer, p_id_operador integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.gerar_requisicoes_compra(p_horizonte_dias integer, p_id_operador integer) TO metabase_user;


--
-- TOC entry 6436 (class 0 OID 0)
-- Dependencies: 650
-- Name: FUNCTION job_atualizar_divergencias(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.job_atualizar_divergencias() TO metabase_user;


--
-- TOC entry 6437 (class 0 OID 0)
-- Dependencies: 672
-- Name: FUNCTION job_sincronizacao_pedidos(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.job_sincronizacao_pedidos() TO metabase_user;


--
-- TOC entry 6438 (class 0 OID 0)
-- Dependencies: 682
-- Name: FUNCTION processar_saida_kardex(p_kardexid_entrada integer, p_kardexid_saida integer, p_quantidade_saida integer, p_usuarioid integer, p_dt_saida timestamp without time zone); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.processar_saida_kardex(p_kardexid_entrada integer, p_kardexid_saida integer, p_quantidade_saida integer, p_usuarioid integer, p_dt_saida timestamp without time zone) TO metabase_user;


--
-- TOC entry 6440 (class 0 OID 0)
-- Dependencies: 634
-- Name: FUNCTION reservar_estoque_pedido(p_pedidovendaid integer, p_id_operador integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.reservar_estoque_pedido(p_pedidovendaid integer, p_id_operador integer) TO metabase_user;


--
-- TOC entry 6441 (class 0 OID 0)
-- Dependencies: 610
-- Name: FUNCTION resolver_divergencia(p_id integer, p_resolvido_por integer, p_observacoes text); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.resolver_divergencia(p_id integer, p_resolvido_por integer, p_observacoes text) TO metabase_user;


--
-- TOC entry 6442 (class 0 OID 0)
-- Dependencies: 652
-- Name: FUNCTION reverter_colunas_espelhadas_produtos(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.reverter_colunas_espelhadas_produtos() TO metabase_user;


--
-- TOC entry 6443 (class 0 OID 0)
-- Dependencies: 631
-- Name: FUNCTION sincronizar_pedidos_separacao(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sincronizar_pedidos_separacao() TO metabase_user;


--
-- TOC entry 6444 (class 0 OID 0)
-- Dependencies: 686
-- Name: FUNCTION sincronizar_saidas_kardex(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sincronizar_saidas_kardex() TO metabase_user;


--
-- TOC entry 6445 (class 0 OID 0)
-- Dependencies: 575
-- Name: FUNCTION sync_estrutura_produtos_from_aworks(p_full_refresh boolean); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sync_estrutura_produtos_from_aworks(p_full_refresh boolean) TO metabase_user;


--
-- TOC entry 6446 (class 0 OID 0)
-- Dependencies: 620
-- Name: FUNCTION sync_produtos_vinculo_estrutura_from_cache(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.sync_produtos_vinculo_estrutura_from_cache() TO metabase_user;


--
-- TOC entry 6447 (class 0 OID 0)
-- Dependencies: 658
-- Name: FUNCTION trigger_sincronizar_pedido_novo(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.trigger_sincronizar_pedido_novo() TO metabase_user;


--
-- TOC entry 6448 (class 0 OID 0)
-- Dependencies: 638
-- Name: FUNCTION update_relatorios_falta_timestamp(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_relatorios_falta_timestamp() TO metabase_user;


--
-- TOC entry 6450 (class 0 OID 0)
-- Dependencies: 666
-- Name: FUNCTION verificar_bloqueio_item(p_pedidovendaitemid integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.verificar_bloqueio_item(p_pedidovendaitemid integer) TO metabase_user;


--
-- TOC entry 6451 (class 0 OID 0)
-- Dependencies: 514
-- Name: TABLE agenda_maquina; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.agenda_maquina TO metabase_user;


--
-- TOC entry 6453 (class 0 OID 0)
-- Dependencies: 513
-- Name: SEQUENCE agenda_maquina_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.agenda_maquina_id_seq TO metabase_user;


--
-- TOC entry 6456 (class 0 OID 0)
-- Dependencies: 512
-- Name: TABLE carga_maquina; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.carga_maquina TO metabase_user;


--
-- TOC entry 6457 (class 0 OID 0)
-- Dependencies: 520
-- Name: TABLE carga_maquina_auditoria; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.carga_maquina_auditoria TO metabase_user;


--
-- TOC entry 6459 (class 0 OID 0)
-- Dependencies: 519
-- Name: SEQUENCE carga_maquina_auditoria_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.carga_maquina_auditoria_id_seq TO metabase_user;


--
-- TOC entry 6461 (class 0 OID 0)
-- Dependencies: 511
-- Name: SEQUENCE carga_maquina_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.carga_maquina_id_seq TO metabase_user;


--
-- TOC entry 6473 (class 0 OID 0)
-- Dependencies: 500
-- Name: TABLE controle_entrada_producao; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.controle_entrada_producao TO metabase_user;


--
-- TOC entry 6475 (class 0 OID 0)
-- Dependencies: 545
-- Name: TABLE divergencias_estoque; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.divergencias_estoque TO metabase_user;


--
-- TOC entry 6477 (class 0 OID 0)
-- Dependencies: 544
-- Name: SEQUENCE divergencias_estoque_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.divergencias_estoque_id_seq TO metabase_user;


--
-- TOC entry 6479 (class 0 OID 0)
-- Dependencies: 486
-- Name: TABLE entrada_producao; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.entrada_producao TO metabase_user;


--
-- TOC entry 6481 (class 0 OID 0)
-- Dependencies: 485
-- Name: SEQUENCE entrada_producao_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.entrada_producao_id_seq TO metabase_user;


--
-- TOC entry 6482 (class 0 OID 0)
-- Dependencies: 488
-- Name: TABLE entrada_producao_itens; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.entrada_producao_itens TO metabase_user;


--
-- TOC entry 6484 (class 0 OID 0)
-- Dependencies: 487
-- Name: SEQUENCE entrada_producao_itens_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.entrada_producao_itens_id_seq TO metabase_user;


--
-- TOC entry 6485 (class 0 OID 0)
-- Dependencies: 499
-- Name: TABLE entrada_producao_saidas_log; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.entrada_producao_saidas_log TO metabase_user;


--
-- TOC entry 6487 (class 0 OID 0)
-- Dependencies: 498
-- Name: SEQUENCE entrada_producao_saidas_log_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.entrada_producao_saidas_log_id_seq TO metabase_user;


--
-- TOC entry 6488 (class 0 OID 0)
-- Dependencies: 506
-- Name: TABLE estoque_auditoria_eventos; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.estoque_auditoria_eventos TO metabase_user;


--
-- TOC entry 6490 (class 0 OID 0)
-- Dependencies: 505
-- Name: SEQUENCE estoque_auditoria_eventos_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.estoque_auditoria_eventos_id_seq TO metabase_user;


--
-- TOC entry 6495 (class 0 OID 0)
-- Dependencies: 492
-- Name: TABLE estoque_consolidado; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.estoque_consolidado TO metabase_user;


--
-- TOC entry 6497 (class 0 OID 0)
-- Dependencies: 502
-- Name: TABLE estoque_movimentacoes; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.estoque_movimentacoes TO metabase_user;


--
-- TOC entry 6499 (class 0 OID 0)
-- Dependencies: 501
-- Name: SEQUENCE estoque_movimentacoes_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.estoque_movimentacoes_id_seq TO metabase_user;


--
-- TOC entry 6500 (class 0 OID 0)
-- Dependencies: 530
-- Name: TABLE estrutura_produtos; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.estrutura_produtos TO metabase_user;


--
-- TOC entry 6502 (class 0 OID 0)
-- Dependencies: 529
-- Name: SEQUENCE estrutura_produtos_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.estrutura_produtos_id_seq TO metabase_user;


--
-- TOC entry 6505 (class 0 OID 0)
-- Dependencies: 525
-- Name: TABLE grupoproduto; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.grupoproduto TO metabase_user;


--
-- TOC entry 6511 (class 0 OID 0)
-- Dependencies: 548
-- Name: TABLE logs_sistema; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.logs_sistema TO metabase_user;


--
-- TOC entry 6513 (class 0 OID 0)
-- Dependencies: 547
-- Name: SEQUENCE logs_sistema_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.logs_sistema_id_seq TO metabase_user;


--
-- TOC entry 6514 (class 0 OID 0)
-- Dependencies: 516
-- Name: TABLE maquina_molde; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.maquina_molde TO metabase_user;


--
-- TOC entry 6516 (class 0 OID 0)
-- Dependencies: 515
-- Name: SEQUENCE maquina_molde_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.maquina_molde_id_seq TO metabase_user;


--
-- TOC entry 6532 (class 0 OID 0)
-- Dependencies: 532
-- Name: TABLE ordem_producao_estrutura_itens; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.ordem_producao_estrutura_itens TO metabase_user;


--
-- TOC entry 6534 (class 0 OID 0)
-- Dependencies: 531
-- Name: SEQUENCE ordem_producao_estrutura_itens_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.ordem_producao_estrutura_itens_id_seq TO metabase_user;


--
-- TOC entry 6535 (class 0 OID 0)
-- Dependencies: 534
-- Name: TABLE ordem_producao_necessidades; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.ordem_producao_necessidades TO metabase_user;


--
-- TOC entry 6537 (class 0 OID 0)
-- Dependencies: 533
-- Name: SEQUENCE ordem_producao_necessidades_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.ordem_producao_necessidades_id_seq TO metabase_user;


--
-- TOC entry 6540 (class 0 OID 0)
-- Dependencies: 523
-- Name: TABLE pedido_itens_aworks_simples_mv; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.pedido_itens_aworks_simples_mv TO metabase_user;


--
-- TOC entry 6541 (class 0 OID 0)
-- Dependencies: 503
-- Name: TABLE pedidos_prontos_despacho_mv; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.pedidos_prontos_despacho_mv TO metabase_user;


--
-- TOC entry 6545 (class 0 OID 0)
-- Dependencies: 508
-- Name: TABLE produtos_cache; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.produtos_cache TO metabase_user;


--
-- TOC entry 6556 (class 0 OID 0)
-- Dependencies: 484
-- Name: TABLE relatorios_falta_estoque; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.relatorios_falta_estoque TO metabase_user;


--
-- TOC entry 6558 (class 0 OID 0)
-- Dependencies: 483
-- Name: SEQUENCE relatorios_falta_estoque_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.relatorios_falta_estoque_id_seq TO metabase_user;


--
-- TOC entry 6559 (class 0 OID 0)
-- Dependencies: 536
-- Name: TABLE requisicao_compra; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.requisicao_compra TO metabase_user;


--
-- TOC entry 6561 (class 0 OID 0)
-- Dependencies: 535
-- Name: SEQUENCE requisicao_compra_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.requisicao_compra_id_seq TO metabase_user;


--
-- TOC entry 6565 (class 0 OID 0)
-- Dependencies: 490
-- Name: TABLE reservas_estoque; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.reservas_estoque TO metabase_user;


--
-- TOC entry 6567 (class 0 OID 0)
-- Dependencies: 489
-- Name: SEQUENCE reservas_estoque_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.reservas_estoque_id_seq TO metabase_user;


--
-- TOC entry 6569 (class 0 OID 0)
-- Dependencies: 481
-- Name: TABLE separacao_itens; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.separacao_itens TO metabase_user;


--
-- TOC entry 6571 (class 0 OID 0)
-- Dependencies: 497
-- Name: TABLE separacao_itens_bloqueio; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.separacao_itens_bloqueio TO metabase_user;


--
-- TOC entry 6572 (class 0 OID 0)
-- Dependencies: 496
-- Name: SEQUENCE separacao_itens_bloqueio_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.separacao_itens_bloqueio_id_seq TO metabase_user;


--
-- TOC entry 6574 (class 0 OID 0)
-- Dependencies: 480
-- Name: SEQUENCE separacao_itens_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.separacao_itens_id_seq TO metabase_user;


--
-- TOC entry 6576 (class 0 OID 0)
-- Dependencies: 479
-- Name: TABLE separacao_pedidos; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.separacao_pedidos TO metabase_user;


--
-- TOC entry 6578 (class 0 OID 0)
-- Dependencies: 478
-- Name: SEQUENCE separacao_pedidos_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.separacao_pedidos_id_seq TO metabase_user;


--
-- TOC entry 6579 (class 0 OID 0)
-- Dependencies: 518
-- Name: TABLE setup_maquina; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.setup_maquina TO metabase_user;


--
-- TOC entry 6581 (class 0 OID 0)
-- Dependencies: 517
-- Name: SEQUENCE setup_maquina_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.setup_maquina_id_seq TO metabase_user;


--
-- TOC entry 6583 (class 0 OID 0)
-- Dependencies: 526
-- Name: TABLE subgrupoproduto; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.subgrupoproduto TO metabase_user;


--
-- TOC entry 6586 (class 0 OID 0)
-- Dependencies: 495
-- Name: TABLE transferencias; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.transferencias TO metabase_user;


--
-- TOC entry 6588 (class 0 OID 0)
-- Dependencies: 494
-- Name: SEQUENCE transferencias_id_seq; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE public.transferencias_id_seq TO metabase_user;


--
-- TOC entry 6591 (class 0 OID 0)
-- Dependencies: 528
-- Name: TABLE vw_analise_estoque_produto; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_analise_estoque_produto TO metabase_user;


--
-- TOC entry 6592 (class 0 OID 0)
-- Dependencies: 504
-- Name: TABLE vw_pedidos_despacho_completo; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_pedidos_despacho_completo TO metabase_user;


--
-- TOC entry 6593 (class 0 OID 0)
-- Dependencies: 543
-- Name: TABLE vw_analise_separacao; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_analise_separacao TO metabase_user;


--
-- TOC entry 6594 (class 0 OID 0)
-- Dependencies: 546
-- Name: TABLE vw_analise_separacao_mv; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_analise_separacao_mv TO metabase_user;


--
-- TOC entry 6595 (class 0 OID 0)
-- Dependencies: 538
-- Name: TABLE vw_dashboard_compras; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_dashboard_compras TO metabase_user;


--
-- TOC entry 6597 (class 0 OID 0)
-- Dependencies: 521
-- Name: TABLE vw_despacho_real; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_despacho_real TO metabase_user;


--
-- TOC entry 6598 (class 0 OID 0)
-- Dependencies: 549
-- Name: TABLE vw_divergencias_pendentes; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_divergencias_pendentes TO metabase_user;


--
-- TOC entry 6599 (class 0 OID 0)
-- Dependencies: 550
-- Name: TABLE vw_divergencias_pendentes_dashboard; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_divergencias_pendentes_dashboard TO metabase_user;


--
-- TOC entry 6600 (class 0 OID 0)
-- Dependencies: 507
-- Name: TABLE vw_entradas_producao_aworks; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_entradas_producao_aworks TO metabase_user;


--
-- TOC entry 6601 (class 0 OID 0)
-- Dependencies: 510
-- Name: TABLE vw_estoque_auditoria_detalhada; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_estoque_auditoria_detalhada TO metabase_user;


--
-- TOC entry 6602 (class 0 OID 0)
-- Dependencies: 509
-- Name: TABLE vw_estoque_completo; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_estoque_completo TO metabase_user;


--
-- TOC entry 6604 (class 0 OID 0)
-- Dependencies: 542
-- Name: TABLE vw_estoque_consolidado; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_estoque_consolidado TO metabase_user;


--
-- TOC entry 6606 (class 0 OID 0)
-- Dependencies: 522
-- Name: TABLE vw_estoque_simples; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_estoque_simples TO metabase_user;


--
-- TOC entry 6607 (class 0 OID 0)
-- Dependencies: 539
-- Name: TABLE vw_materiais_criticos; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_materiais_criticos TO metabase_user;


--
-- TOC entry 6608 (class 0 OID 0)
-- Dependencies: 493
-- Name: TABLE vw_palets_chao; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_palets_chao TO metabase_user;


--
-- TOC entry 6609 (class 0 OID 0)
-- Dependencies: 482
-- Name: TABLE vw_pedido_itens_aworks; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_pedido_itens_aworks TO metabase_user;


--
-- TOC entry 6611 (class 0 OID 0)
-- Dependencies: 524
-- Name: TABLE vw_pedido_itens_aworks_simples; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_pedido_itens_aworks_simples TO metabase_user;


--
-- TOC entry 6613 (class 0 OID 0)
-- Dependencies: 527
-- Name: TABLE vw_produtos_grupo_subgrupo; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_produtos_grupo_subgrupo TO metabase_user;


--
-- TOC entry 6614 (class 0 OID 0)
-- Dependencies: 537
-- Name: TABLE vw_requisicoes_compra_pendentes; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_requisicoes_compra_pendentes TO metabase_user;


--
-- TOC entry 6615 (class 0 OID 0)
-- Dependencies: 491
-- Name: TABLE vw_reservas_ativas; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_reservas_ativas TO metabase_user;


--
-- TOC entry 6616 (class 0 OID 0)
-- Dependencies: 541
-- Name: TABLE vw_separacao_pedidos_completa; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_separacao_pedidos_completa TO metabase_user;


--
-- TOC entry 6617 (class 0 OID 0)
-- Dependencies: 540
-- Name: TABLE vw_separacao_pedidos_rapida; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE public.vw_separacao_pedidos_rapida TO metabase_user;


--
-- TOC entry 2919 (class 826 OID 3088473)
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO metabase_user;


--
-- TOC entry 2920 (class 826 OID 3088474)
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO metabase_user;


--
-- TOC entry 2918 (class 826 OID 3088472)
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLES TO metabase_user;


-- Completed on 2026-08-13 16:57:44

--
-- PostgreSQL database dump complete
--

\unrestrict a3Xrnira5iI6RCRbQQZHxelI1OupmlEvNB6yoXRjN1YAKKpMc8w5nB1aQcCoeeI

